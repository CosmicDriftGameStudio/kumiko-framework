import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { CAP_COUNTER_LIST_SCREEN_ID, CapCounterHandlers, CapCounterQueries } from "../constants";
import { capCounterEntity } from "../entity";
import { capCounterFeature } from "../feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [capCounterFeature],
  });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function tenantAdminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

describe("cap-counter access matrix", () => {
  test("cap-list screen and list query are SystemAdmin-only", () => {
    expect(rolesOf(stack.registry.getQueryHandler(CapCounterQueries.list)?.access)).toEqual([
      "SystemAdmin",
    ]);
    const screen = capCounterFeature.screens[CAP_COUNTER_LIST_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(["SystemAdmin"]);
    }
  });
});

describe("cap-counter list HTTP access", () => {
  test("SystemAdmin can list counters", async () => {
    const admin = createTestUser({ id: 41, roles: ["SystemAdmin"] });
    const res = await stack.http.queryOk<{ rows: readonly unknown[] }>(
      CapCounterQueries.list,
      {},
      admin,
    );
    expect(Array.isArray(res.rows)).toBe(true);
  });

  test("TenantAdmin gets 403 on list", async () => {
    const user = createTestUser({ id: 42, roles: ["TenantAdmin"] });
    expect((await stack.http.query(CapCounterQueries.list, {}, user)).status).toBe(403);
  });
});

describe("cap-counter list cross-tenant read", () => {
  const CAP_NAME = "cross-tenant-list-probe";

  beforeEach(async () => {
    // increment access is SystemAdmin-only (see increment.write.ts) — tenant
    // scoping on the write side comes from the actor's tenantId, not the
    // role, so a SystemAdmin actor per seed-tenant still writes into that
    // tenant's own row.
    const seedTenantA = createTestUser({
      id: 201,
      tenantId: testTenantId(201),
      roles: ["SystemAdmin"],
    });
    const seedTenantB = createTestUser({
      id: 202,
      tenantId: testTenantId(202),
      roles: ["SystemAdmin"],
    });
    await stack.http.writeOk(
      CapCounterHandlers.increment,
      { capName: CAP_NAME, amount: 11, periodStartIso: "2026-05-01T00:00:00Z" },
      seedTenantA,
    );
    await stack.http.writeOk(
      CapCounterHandlers.increment,
      { capName: CAP_NAME, amount: 22, periodStartIso: "2026-05-01T00:00:00Z" },
      seedTenantB,
    );
  });

  test("SystemAdmin sees rows from BOTH tenants, not just its own", async () => {
    const sysadmin = createTestUser({ id: 43, roles: ["SystemAdmin"] });
    const res = await stack.http.queryOk<{ rows: readonly Record<string, unknown>[] }>(
      CapCounterQueries.list,
      { filter: { field: "capName", op: "eq", value: CAP_NAME } },
      sysadmin,
    );

    const tenantIds = res.rows.map((row) => row["tenantId"]);
    expect(tenantIds).toContain(testTenantId(201));
    expect(tenantIds).toContain(testTenantId(202));
    // Neither seeded tenant matches the querying SystemAdmin's own
    // tenantId — proves this isn't accidentally passing via tenant-match.
    expect(sysadmin.tenantId).not.toBe(testTenantId(201));
    expect(sysadmin.tenantId).not.toBe(testTenantId(202));
  });

  test("TenantAdmin still gets 403 on list (cross-tenant read stays SystemAdmin-only)", async () => {
    const tenantAdmin = tenantAdminFor(201);
    expect((await stack.http.query(CapCounterQueries.list, {}, tenantAdmin)).status).toBe(403);
  });
});
