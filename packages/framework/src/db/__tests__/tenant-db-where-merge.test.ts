import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine";
import { testTenantId } from "../../stack";
import type { TableColumns } from "../dialect";
import { buildEntityTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

// Tenant-isolation: a caller-supplied `where.tenantId` must NEVER override the
// enforced tenant scope. These tests drive the real query-builder against a
// recording fake runner and assert on the emitted SQL + bound values — no
// Postgres needed because the bug lives entirely in the WHERE-object merge.

const entity = createEntity({
  table: "merge_items",
  fields: { name: createTextField({ required: true }) },
});
// Brand (#742) is compile-time-only; hold the handle at the unbranded TableColumns
// view so the method-form scoping test still compiles (runtime shape is identical).
const table: TableColumns = buildEntityTable("mergeItem", entity);

const own = testTenantId(1);
const foreign = testTenantId(2);

type Captured = { sql: string; values: readonly unknown[] };

function recordingDb(captured: Captured[]) {
  return {
    unsafe: async (sql: string, values: readonly unknown[]) => {
      captured.push({ sql, values });
      return [] as unknown[];
    },
  };
}

describe("tenant-db WHERE merge — caller cannot override tenant scope", () => {
  test("selectMany ignores a foreign where.tenantId and keeps the IN-scope filter", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.selectMany(table, { tenantId: foreign });

    expect(captured).toHaveLength(1);
    // The enforced scope is an IN over [own, SYSTEM_TENANT_ID]; the foreign id
    // must not appear as a sole-equality predicate (the pre-fix bug).
    expect(captured[0]?.sql).toMatch(/tenant_id" IN /i);
    expect(captured[0]?.values).toContain(own);
    expect(captured[0]?.values).not.toContain(foreign);
  });

  test("updateMany forces own tenantId even when where.tenantId is foreign", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.updateMany(table, { name: "x" }, { tenantId: foreign });

    const update = captured.find((c) => /UPDATE/i.test(c.sql));
    expect(update).toBeDefined();
    expect(update?.values).toContain(own);
    expect(update?.values).not.toContain(foreign);
  });

  test("deleteMany forces own tenantId even when where.tenantId is foreign", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.deleteMany(table, { tenantId: foreign });

    const del = captured.find((c) => /DELETE/i.test(c.sql));
    expect(del).toBeDefined();
    expect(del?.values).toContain(own);
    expect(del?.values).not.toContain(foreign);
  });

  test("a non-tenantId where predicate is still applied alongside the scope", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.selectMany(table, { name: "needle" });

    expect(captured[0]?.sql).toMatch(/tenant_id" IN /i);
    expect(captured[0]?.values).toContain("needle");
    expect(captured[0]?.values).toContain(own);
  });
});

describe("tenant-db WHERE merge — narrowing within the enforced scope", () => {
  const SYSTEM = "00000000-0000-4000-8000-000000000000";

  test("where.tenantId = own narrows to own only (excludes SYSTEM reference rows)", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.selectMany(table, { tenantId: own });

    expect(captured[0]?.values).toContain(own);
    expect(captured[0]?.values).not.toContain(SYSTEM);
  });

  test("where.tenantId = [own, SYSTEM] keeps both", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.selectMany(table, { tenantId: [own, SYSTEM] });

    expect(captured[0]?.values).toContain(own);
    expect(captured[0]?.values).toContain(SYSTEM);
  });

  test("mixed [own, foreign] drops the foreign id, keeps own", async () => {
    const captured: Captured[] = [];
    const tdb = createTenantDb(recordingDb(captured), own);

    await tdb.selectMany(table, { tenantId: [own, foreign] });

    expect(captured[0]?.values).toContain(own);
    expect(captured[0]?.values).not.toContain(foreign);
  });
});
