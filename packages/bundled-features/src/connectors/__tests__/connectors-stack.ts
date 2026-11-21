import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
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
import { createFilesTenantDataFeature } from "../../files-tenant-data/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  CONNECTOR_CLIENT_ID,
  CONNECTOR_ROUTE_PATHS,
  ConnectorHandlers,
  ConnectorQueries,
  DEFAULT_CONNECTORS_BASE_PATH,
  DEVICE_CODE_GRANT_TYPE,
} from "../constants.ts";
import { type ConnectorsFeatureOptions, createConnectorsFeature } from "../feature.ts";
import { type ConnectorRouteOptions, createConnectorRoutes } from "../routes.ts";
import { pairConnectorDevice, postForm, sha256Hex } from "../testing.ts";

export const TEST_NOW = Temporal.Instant.from("2026-11-19T10:00:00Z");
export const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });
export const plainUser = createTestUser({ roles: ["User"] });

export const START_PATH = `${DEFAULT_CONNECTORS_BASE_PATH}${CONNECTOR_ROUTE_PATHS.deviceAuthorization}`;
export const TOKEN_PATH = `${DEFAULT_CONNECTORS_BASE_PATH}${CONNECTOR_ROUTE_PATHS.token}`;
export const FILES_PATH = `${DEFAULT_CONNECTORS_BASE_PATH}${CONNECTOR_ROUTE_PATHS.files}`;
export const HEARTBEAT_PATH = `${DEFAULT_CONNECTORS_BASE_PATH}${CONNECTOR_ROUTE_PATHS.heartbeat}`;

export async function setupConnectorsStack(
  options: ConnectorRouteOptions &
    ConnectorsFeatureOptions & { extraFeatures?: readonly FeatureDefinition[] } = {},
  trustedProxyHops?: number,
  fileProvider: InMemoryFileProvider = createInMemoryFileProvider(),
): Promise<TestStack> {
  const {
    maxStoredBytesPerTenant,
    folderDeleteBatchSize,
    maxSearchNames,
    extraFeatures = [],
    ...routes
  } = options;
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createFilesFeature(),
      createFilesTenantDataFeature(),
      createConnectorsFeature({
        ...(maxStoredBytesPerTenant !== undefined && { maxStoredBytesPerTenant }),
        ...(folderDeleteBatchSize !== undefined && { folderDeleteBatchSize }),
        ...(maxSearchNames !== undefined && { maxSearchNames }),
      }),
      ...extraFeatures,
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
    files: { storageProvider: fileProvider },
    // The folder deletion job runs on the worker lane; tests drain it with `runConnectorJobs`.
    jobs: { consumerLane: "worker", queueNamePrefix: `connectors-${generateId()}` },
    now: TEST_NOW,
    ...(trustedProxyHops !== undefined && { trustedProxyHops }),
  });
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  return stack;
}

export function teardownConnectorsStack(stack: TestStack): Promise<void> {
  resetPiiSubjectKmsForTests();
  return stack.cleanup();
}

export { postForm, sha256Hex };

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
    grant_type: DEVICE_CODE_GRANT_TYPE,
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

export function pairDevice(stack: TestStack, name = "Office server") {
  return pairConnectorDevice(stack, tenantAdmin, { name });
}

export async function listConnectors(stack: TestStack) {
  const page = await stack.http.queryOk<{
    rows: {
      id: string;
      name: string;
      status: string;
      lastSeenAt: string | null;
      reportedVersion: string | null;
      syncStatus: string;
      syncDetail: { i18nKey: string; i18nParams?: { count: number } } | null;
    }[];
  }>(ConnectorQueries.list, {}, tenantAdmin);
  return page.rows;
}
