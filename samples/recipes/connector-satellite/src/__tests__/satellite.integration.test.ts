import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTenantFeature,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
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
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { connectorRoutes, connectorsFeature } from "../feature.ts";

const admin = createTestUser({ roles: ["TenantAdmin"] });
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
let stack: TestStack;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createFilesFeature(),
      connectorsFeature,
    ],
    extraRoutes: connectorRoutes,
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});
afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

test("a satellite pairs, is confirmed by a TenantAdmin and uploads a file once", async () => {
  const started = (await (
    await stack.app.request(
      "/connectors/v1/device_authorization",
      form({ client_id: "kumiko-satellite" }),
    )
  ).json()) as { device_code: string; user_code: string };

  await stack.http.writeOk("connectors:write:check-device", { userCode: started.user_code }, admin);
  await stack.http.writeOk(
    "connectors:write:approve-device",
    { userCode: started.user_code, name: "Warehouse server" },
    admin,
  );
  const granted = (await (
    await stack.app.request(
      "/connectors/v1/token",
      form({
        grant_type: DEVICE_GRANT,
        device_code: started.device_code,
        client_id: "kumiko-satellite",
      }),
    )
  ).json()) as { access_token: string };

  const bytes = new TextEncoder().encode("delivery note 4711");
  const send = () =>
    stack.app.request("/connectors/v1/files", {
      method: "POST",
      headers: {
        authorization: `Bearer ${granted.access_token}`,
        "content-type": "application/octet-stream",
        "x-kumiko-path": encodeURIComponent("2026/note.txt"),
        "x-kumiko-sha256": createHash("sha256").update(bytes).digest("hex"),
        "x-kumiko-mtime": "2026-11-18T08:30:00Z",
      },
      body: bytes,
    });
  expect((await send()).status).toBe(201);
  expect(await (await send()).json()).toMatchObject({ duplicate: true });
});
