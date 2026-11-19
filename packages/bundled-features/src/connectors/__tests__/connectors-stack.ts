import { createHash } from "node:crypto";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { CONNECTOR_CLIENT_ID, ConnectorHandlers, ConnectorQueries } from "../constants.ts";
import { createConnectorsFeature } from "../feature.ts";
import { type ConnectorRouteOptions, createConnectorRoutes } from "../routes.ts";

export const TEST_NOW = Temporal.Instant.from("2026-11-19T10:00:00Z");
export const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });
export const plainUser = createTestUser({ roles: ["User"] });

export const START_PATH = "/connectors/v1/device_authorization";
export const TOKEN_PATH = "/connectors/v1/token";
export const FILES_PATH = "/connectors/v1/files";
export const HEARTBEAT_PATH = "/connectors/v1/heartbeat";
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export async function setupConnectorsStack(routes: ConnectorRouteOptions = {}): Promise<TestStack> {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createFilesFeature(),
      createConnectorsFeature(),
    ],
    // Generous defaults: most tests start many pairings from the one test address.
    extraRoutes: createConnectorRoutes({
      ...routes,
      pairingLimits: {
        startsPerMinute: 1000,
        maxOpenPerIp: 1000,
        maxOpenTotal: 100000,
        ...routes.pairingLimits,
      },
    }),
    files: { storageProvider: createInMemoryFileProvider() },
    now: TEST_NOW,
  });
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  return stack;
}

export function teardownConnectorsStack(stack: TestStack): Promise<void> {
  resetPiiSubjectKmsForTests();
  return stack.cleanup();
}

export function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export function postForm(stack: TestStack, path: string, fields: Record<string, string>) {
  return stack.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody(fields),
  });
}

export async function startPairing(stack: TestStack) {
  const res = await postForm(stack, START_PATH, { client_id: CONNECTOR_CLIENT_ID });
  const body = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return { res, ...body };
}

export function pollToken(stack: TestStack, deviceCode: string) {
  return postForm(stack, TOKEN_PATH, {
    grant_type: DEVICE_GRANT,
    device_code: deviceCode,
    client_id: CONNECTOR_CLIENT_ID,
  });
}

// Confirming needs a check of the same code by the same admin first (the confirm screen's step one).
export function checkCode(
  stack: TestStack,
  userCode: string,
  user: typeof tenantAdmin = tenantAdmin,
) {
  return stack.http.writeOk(ConnectorHandlers.checkDevice, { userCode }, user);
}

export async function approve(stack: TestStack, userCode: string, name = "Office server") {
  await checkCode(stack, userCode);
  return stack.http.writeOk<{ connectorId: string }>(
    ConnectorHandlers.approveDevice,
    { userCode, name },
    tenantAdmin,
  );
}

export async function pairDevice(stack: TestStack, name = "Office server") {
  const started = await startPairing(stack);
  const { connectorId } = await approve(stack, started.user_code, name);
  const res = await pollToken(stack, started.device_code);
  const body = (await res.json()) as { access_token: string };
  return { token: body.access_token, connectorId };
}

export async function listConnectors(stack: TestStack) {
  const page = await stack.http.queryOk<{
    rows: {
      id: string;
      name: string;
      status: string;
      lastSeenAt: string | null;
      reportedVersion: string | null;
    }[];
  }>(ConnectorQueries.list, {}, tenantAdmin);
  return page.rows;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function upload(
  stack: TestStack,
  token: string | null,
  file: { path: string; bytes: Uint8Array<ArrayBuffer>; sha256?: string; mtime?: string },
) {
  return stack.app.request(FILES_PATH, {
    method: "POST",
    headers: {
      ...(token !== null && { authorization: `Bearer ${token}` }),
      "content-type": "application/octet-stream",
      "x-kumiko-path": encodeURIComponent(file.path),
      "x-kumiko-sha256": file.sha256 ?? sha256Hex(file.bytes),
      "x-kumiko-mtime": file.mtime ?? "2026-11-18T08:30:00Z",
    },
    body: file.bytes,
  });
}
