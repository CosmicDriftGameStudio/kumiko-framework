// Regression test for the tenant-scope override bug: checkStockCap used to
// spread `spec.where` AFTER the injected `tenantId`, so a `where` object
// carrying its own `tenantId` key silently overrode the caller's real tenant
// and the count ran against the wrong tenant's rows. fw#2854: checkStockCap
// now takes a TenantDb (not a raw DbRunner + explicit tenantId) — the
// tenant-scoping guarantee comes from TenantDb.count's own readWhere
// narrowing instead of a hand-rolled spread order.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineFeature,
  type SessionUser,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { capCounterEntity } from "../entity";
import { createStockCapGuard } from "../stock-cap-guard";

const { executor, table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  db = stack.db;
  await unsafeCreateEntityTable(db, capCounterEntity, "cap-counter");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [capCounterTable, eventsTable]);
});

function seedUser(tenantId: ReturnType<typeof testTenantId>): SessionUser {
  return { id: "seed-user", tenantId, roles: ["SystemAdmin"] };
}

async function seedCounterRow(tenantId: ReturnType<typeof testTenantId>): Promise<void> {
  const result = await executor.create(
    { tenantId, capName: "x", value: 0, periodStart: "2026-07-01T00:00:00Z" },
    seedUser(tenantId),
    createTenantDb(db, tenantId),
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${JSON.stringify(result)}`);
}

describe("checkStockCap tenant scoping", () => {
  test("spec.where cannot override the caller's real tenantId", async () => {
    const realTenant = testTenantId(1);
    const otherTenant = testTenantId(2);

    // 5 rows live under otherTenant — realTenant has none.
    for (let i = 0; i < 5; i++) {
      await seedCounterRow(otherTenant);
    }

    const guard = createStockCapGuard(async () => ({}));
    const failure = await guard.checkStockCap(createTenantDb(db, realTenant), {
      table: capCounterTable,
      limit: () => 1,
      // A where object that (accidentally or maliciously) carries its own
      // tenantId must NOT be able to redirect the count to another tenant.
      where: { tenantId: otherTenant, capName: "x" },
      code: "cap-exceeded",
      i18nKey: "cap.exceeded",
      field: "capName",
    });

    // realTenant has zero matching rows — must not see otherTenant's 5.
    expect(failure).toBeNull();
  });

  test("still enforces the cap for the caller's own tenant", async () => {
    const tenant = testTenantId(1);
    for (let i = 0; i < 2; i++) {
      await seedCounterRow(tenant);
    }

    const guard = createStockCapGuard(async () => ({}));
    const failure = await guard.checkStockCap(createTenantDb(db, tenant), {
      table: capCounterTable,
      limit: () => 1,
      where: { capName: "x" },
      code: "cap-exceeded",
      i18nKey: "cap.exceeded",
      field: "capName",
    });

    expect(failure).not.toBeNull();
  });
});

// =============================================================================
// withStockCap over HTTP — proves the guard works end-to-end through the
// real dispatcher for a TenantAdmin-only handler with no escapeHatch (fw#2854
// withStockCap no longer declares one — checkStockCap resolves through the
// caller's own TenantDb, no unfiltered read needed).
// =============================================================================

const STOCK_LIMIT = 2;
const stockGuard = createStockCapGuard(async () => ({ maxItems: STOCK_LIMIT }));

const createItemSchema = z.object({ capName: z.string() });

const createItemHandler: WriteHandlerDef = {
  name: "create-item",
  schema: createItemSchema,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = event.payload as z.infer<typeof createItemSchema>; // @cast-boundary engine-payload
    return executor.create(
      {
        tenantId: event.user.tenantId,
        capName: payload.capName,
        value: 0,
        periodStart: "2026-07-01T00:00:00Z",
      },
      event.user,
      ctx.db,
    );
  },
};

const guardedCreateItemHandler = stockGuard.withStockCap(createItemHandler, {
  table: capCounterTable,
  limit: (caps: { maxItems: number }) => caps.maxItems,
  where: { capName: "http-stock-item" },
  code: "stock_cap_exceeded",
  i18nKey: "cap.stock-exceeded",
  field: "capName",
});

const STOCK_ITEM_QN = "stock-item:write:create-item";
const stockItemFeature = defineFeature("stock-item", (r) => {
  r.writeHandler(guardedCreateItemHandler);
});

describe("withStockCap over HTTP — TenantAdmin-only caller, no escapeHatch", () => {
  let httpStack: TestStack;

  beforeAll(async () => {
    httpStack = await setupTestStack({ features: [stockItemFeature] });
    await unsafeCreateEntityTable(httpStack.db, capCounterEntity, "cap-counter");
  });

  afterAll(async () => {
    await httpStack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(httpStack.db, [capCounterTable, eventsTable]);
  });

  function tenantAdminOnlyFor(tenantNumber: number) {
    return createTestUser({
      id: tenantNumber,
      tenantId: testTenantId(tenantNumber),
      roles: ["TenantAdmin"],
    });
  }

  test("tenant A reaches its cap over HTTP and gets the failure", async () => {
    const admin = tenantAdminOnlyFor(3101);

    await httpStack.http.writeOk(STOCK_ITEM_QN, { capName: "http-stock-item" }, admin);
    await httpStack.http.writeOk(STOCK_ITEM_QN, { capName: "http-stock-item" }, admin);

    const error = await httpStack.http.writeErr(
      STOCK_ITEM_QN,
      { capName: "http-stock-item" },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe("cap.stock-exceeded");
    expect(error.details).toMatchObject({ reason: "stock_cap_exceeded", current: 2, limit: 2 });
  });

  test("tenant B with 0 rows still succeeds (tenant isolation through the real dispatcher)", async () => {
    const admin = tenantAdminOnlyFor(3102);
    const other = tenantAdminOnlyFor(3103);

    await httpStack.http.writeOk(STOCK_ITEM_QN, { capName: "http-stock-item" }, admin);
    await httpStack.http.writeOk(STOCK_ITEM_QN, { capName: "http-stock-item" }, admin);

    // Tenant A is now at its cap, but tenant B has zero rows of its own.
    const created = await httpStack.http.writeOk(
      STOCK_ITEM_QN,
      { capName: "http-stock-item" },
      other,
    );
    expect(created["data"]).toMatchObject({ capName: "http-stock-item" });

    const otherCount = await createTenantDb(httpStack.db, other.tenantId).count(capCounterTable, {
      capName: "http-stock-item",
    });
    expect(otherCount).toBe(1);
  });
});
