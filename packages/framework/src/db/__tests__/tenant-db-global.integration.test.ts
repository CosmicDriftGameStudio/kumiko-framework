// fw#2855 — db.global(table) against real Postgres: tenant filter lifted, caller's
// `where` still applies; a normal accessor on the same table still filters by tenant.
// Follows tenant-db-where-merge.integration.test.ts's setupTestStack pattern.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack, testTenantId, unsafePushTables } from "../../stack";
import type { TableColumns } from "../dialect";
import { defineUnmanagedTable } from "../entity-table-meta";
import { insertOne } from "../query";
import { createTenantDb } from "../tenant-db";

const globalItemsTable = defineUnmanagedTable({
  tableName: "store_fw2855_global_items_it",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "some_field", pgType: "text", notNull: true },
  ],
});

let stack: TestStack;

const tenantA = testTenantId(91);
const tenantB = testTenantId(92);

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafePushTables(stack.db, { globalItems: globalItemsTable });
  await insertOne(stack.db, globalItemsTable, { tenantId: tenantA, someField: "match" });
  await insertOne(stack.db, globalItemsTable, { tenantId: tenantB, someField: "match" });
  await insertOne(stack.db, globalItemsTable, { tenantId: tenantB, someField: "no-match" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("TenantDb.global() — reads, real Postgres", () => {
  test("db.global(t).selectMany keeps the field filter but drops the tenant filter", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    const rows = await tdb.global(globalItemsTable).selectMany<{
      tenantId: string;
      someField: string;
    }>({ someField: "match" });

    const tenantIds = rows.map((r) => r.tenantId).sort();
    expect(tenantIds).toEqual([tenantA, tenantB].sort());
    expect(rows.every((r) => r.someField === "match")).toBe(true);
  });

  test("the normal (non-global) db.selectMany on the same table still filters by tenant", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    // selectMany's Table param types the branded-EntityTable shape only;
    // EntityTableMeta reads work identically at runtime (both normalize via
    // asEntityTableMeta) — same unbranded-view cast as tenant-db-where-merge.test.ts.
    const rows = await tdb.selectMany<{ tenantId: string; someField: string }>(
      globalItemsTable as unknown as TableColumns,
      { someField: "match" },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantA);
  });
});

describe("TenantDb.global() — writes, real Postgres", () => {
  test("insert/update/delete succeed when createTenantDb was given an escapeHatch", async () => {
    const tdb = createTenantDb(stack.db, tenantA, "tenant", undefined, undefined, undefined, {
      reason: "fw#2855 integration test — cross-tenant write via db.global()",
    });
    const globalDb = tdb.global(globalItemsTable);

    const inserted = await globalDb.insertOne<{ id: string; tenantId: string }>({
      tenantId: tenantB,
      someField: "escape-hatch-insert",
    });
    if (!inserted) throw new Error("insertOne returned no row");
    expect(inserted.tenantId).toBe(tenantB);

    const updated = await globalDb.updateMany<{ someField: string }>(
      { someField: "escape-hatch-update" },
      { id: inserted.id },
    );
    expect(updated[0]?.someField).toBe("escape-hatch-update");

    await globalDb.deleteMany({ id: inserted.id });
    const remaining = await globalDb.selectMany({ id: inserted.id });
    expect(remaining).toHaveLength(0);
  });
});
