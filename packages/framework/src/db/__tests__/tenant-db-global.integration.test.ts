// fw#2858 — db.global(table) against real Postgres: a "global" unmanaged table has
// no tenant_id column at all (binding decision, issue comment 2026-09-14), so its
// rows are tenant-agnostic — every caller sees the same rows through db.global().
// A normal tenancy: "tenant" table is unaffected and still isolates by tenant.
// Follows tenant-db-where-merge.integration.test.ts's setupTestStack pattern.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AccessDeniedError } from "../../errors";
import { setupTestStack, type TestStack, testTenantId, unsafePushTables } from "../../stack";
import type { TableColumns } from "../dialect";
import { defineUnmanagedTable } from "../entity-table-meta";
import { insertOne } from "../query";
import { createTenantDb } from "../tenant-db";

const globalItemsTable = defineUnmanagedTable({
  tableName: "store_fw2858_global_items_it",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "some_field", pgType: "text", notNull: true },
  ],
});

const tenantItemsTable = defineUnmanagedTable({
  tableName: "store_fw2858_tenant_items_it",
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

const tenantA = testTenantId(93);
const tenantB = testTenantId(94);

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafePushTables(stack.db, {
    globalItems: globalItemsTable,
    tenantItems: tenantItemsTable,
  });
  await insertOne(stack.db, globalItemsTable, { someField: "match" });
  await insertOne(stack.db, globalItemsTable, { someField: "match" });
  await insertOne(stack.db, globalItemsTable, { someField: "no-match" });
  await insertOne(stack.db, tenantItemsTable, { tenantId: tenantA, someField: "match" });
  await insertOne(stack.db, tenantItemsTable, { tenantId: tenantB, someField: "match" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("TenantDb.global() — reads, real Postgres", () => {
  test("selectMany returns the same rows to callers on different tenants, unfiltered by tenant", async () => {
    const rowsForA = await createTenantDb(stack.db, tenantA)
      .global(globalItemsTable)
      .selectMany<{ id: string; someField: string }>({ someField: "match" });
    const rowsForB = await createTenantDb(stack.db, tenantB)
      .global(globalItemsTable)
      .selectMany<{ id: string; someField: string }>({ someField: "match" });

    expect(rowsForA).toHaveLength(2);
    expect(rowsForA.map((r) => r.id).sort()).toEqual(rowsForB.map((r) => r.id).sort());
  });

  test("fetchOne finds a row for a caller whose own tenant never wrote it", async () => {
    const row = await createTenantDb(stack.db, tenantA)
      .global(globalItemsTable)
      .fetchOne<{ someField: string }>({ someField: "no-match" });

    expect(row?.someField).toBe("no-match");
  });
});

describe("TenantDb — tenant-mode isolation on a normal tenant table", () => {
  test("db.selectMany only returns the caller's own tenant's rows", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    // selectMany's Table param types the branded-EntityTable shape only;
    // EntityTableMeta reads work identically at runtime (both normalize via
    // asEntityTableMeta) — same unbranded-view cast as tenant-db-where-merge.test.ts.
    const rows = await tdb.selectMany<{ tenantId: string; someField: string }>(
      tenantItemsTable as unknown as TableColumns,
      { someField: "match" },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantA);
  });
});

describe("TenantDb.global() — writes, real Postgres", () => {
  test("insert/update/delete are rejected without a globalWrites grant", async () => {
    const tdb = createTenantDb(stack.db, tenantA);
    await expect(
      tdb.global(globalItemsTable).insertOne({ someField: "ungranted" }),
    ).rejects.toThrow(AccessDeniedError);
  });

  test("insert/update/delete succeed when createTenantDb was given a globalWrites grant", async () => {
    const tdb = createTenantDb(stack.db, tenantA, "tenant", undefined, undefined, undefined, {
      globalWrites: { reason: "fw#2858 integration test — cross-tenant write via db.global()" },
    });
    const globalDb = tdb.global(globalItemsTable);

    const inserted = await globalDb.insertOne<{ id: string }>({
      someField: "escape-hatch-insert",
    });
    if (!inserted) throw new Error("insertOne returned no row");

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
