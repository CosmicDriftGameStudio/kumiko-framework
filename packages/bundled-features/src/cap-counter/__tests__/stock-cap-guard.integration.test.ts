// Regression test for the tenant-scope override bug: checkStockCap used to
// spread `spec.where` AFTER the injected `tenantId`, so a `where` object
// carrying its own `tenantId` key silently overrode the caller's real tenant
// and the count ran against the wrong tenant's rows.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createEntityExecutor, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { capCounterEntity } from "../entity";
import { createStockCapGuard } from "../stock-cap-guard";

const { executor, table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  db = stack.db;
  await unsafeCreateEntityTable(db, capCounterEntity, "cap-counter");
  await createEventsTable(db);
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
    const failure = await guard.checkStockCap(db, realTenant, {
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
    const failure = await guard.checkStockCap(db, tenant, {
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
