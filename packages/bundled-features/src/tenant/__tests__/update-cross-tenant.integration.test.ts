// Security regression: tenant:write:update is systemScope() (ctx.db is not
// tenant-scoped), so without a self-check a caller with the tenant-scoped
// TenantAdmin/Admin role could pass a foreign tenantId as payload.id and update another
// tenant's row. Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../feature.ts";
import { tenantEntity } from "../schema/tenant.ts";
import { TenantHandlers } from "../web/constants.ts";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature()],
    extraContext: { configResolver: createConfigResolver() },
  });

  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant:write:update cross-tenant self-check", () => {
  test("Admin can update its own tenant", async () => {
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TestUsers.admin.tenantId, key: "own-tenant", name: "Own Tenant" },
      TestUsers.systemAdmin,
    );

    const data = await stack.http.writeOk(
      TenantHandlers.update,
      { id: TestUsers.admin.tenantId, changes: { name: "Own Tenant Renamed" }, version: 1 },
      TestUsers.admin,
    );
    expect((data!["data"] as Record<string, unknown>)["name"]).toBe("Own Tenant Renamed");
  });

  test("Admin cannot update a different tenant", async () => {
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TestUsers.otherTenant.tenantId, key: "victim-tenant", name: "Victim Tenant" },
      TestUsers.systemAdmin,
    );

    const err = await stack.http.writeErr(
      TenantHandlers.update,
      { id: TestUsers.otherTenant.tenantId, changes: { name: "Pwned" }, version: 1 },
      TestUsers.admin,
    );
    expectErrorIncludes(err, "tenant_not_found");
  });

  test("SystemAdmin can still update any tenant", async () => {
    const data = await stack.http.writeOk(
      TenantHandlers.update,
      {
        id: TestUsers.otherTenant.tenantId,
        changes: { name: "Renamed By SystemAdmin" },
        version: 1,
      },
      TestUsers.systemAdmin,
    );
    expect((data!["data"] as Record<string, unknown>)["name"]).toBe("Renamed By SystemAdmin");
  });

  test("a TenantAdmin without Admin renames its own tenant but not another one", async () => {
    const ownTenantId = testTenantId(7);
    const tenantAdminOnly = createTestUser({
      id: 77,
      tenantId: ownTenantId,
      roles: ["TenantAdmin"],
    });
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: ownTenantId, key: "tenant-admin-own", name: "TA Own" },
      TestUsers.systemAdmin,
    );
    const data = await stack.http.writeOk(
      TenantHandlers.update,
      { id: ownTenantId, changes: { name: "TA Renamed" }, version: 1 },
      tenantAdminOnly,
    );
    expect((data!["data"] as Record<string, unknown>)["name"]).toBe("TA Renamed");
    const err = await stack.http.writeErr(
      TenantHandlers.update,
      { id: TestUsers.otherTenant.tenantId, changes: { name: "Pwned" }, version: 2 },
      tenantAdminOnly,
    );
    expectErrorIncludes(err, "tenant_not_found");
  });
});
