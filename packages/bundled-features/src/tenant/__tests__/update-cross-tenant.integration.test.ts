// Security regression: tenant:write:update is systemScope() (ctx.db is not
// tenant-scoped), so without a self-check a caller with the tenant-scoped
// "Admin" role could pass a foreign tenantId as payload.id and update another
// tenant's row. Real HTTP via setupTestStack — no mocks.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { TenantHandlers } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantEntity } from "../schema/tenant";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature()],
    extraContext: { configResolver: createConfigResolver() },
  });

  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await createEventsTable(stack.db);
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
});
