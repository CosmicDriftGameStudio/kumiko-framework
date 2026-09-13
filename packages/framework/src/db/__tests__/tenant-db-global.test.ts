import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type { TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";
import { createEntity, createTextField } from "../../engine";
import { testTenantId } from "../../stack";
import type { DbRunner } from "../connection";
import { defineUnmanagedTable, deriveEntityTableMeta } from "../entity-table-meta";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, createUncheckedSystemDb, type TenantDb } from "../tenant-db";

// db.global()'s runtime + write-gate behaviour (fw#2855). No Postgres needed —
// the stub runner throws on first touch, so a test that reaches it fails loudly
// instead of silently "passing" on an accidental real write.
function unreachableRunner(): DbRunner {
  return {
    unsafe: async () => {
      throw new Error("db.global(): must not touch the DB runner here");
    },
    begin: async () => {
      throw new Error("db.global(): must not touch the DB runner here");
    },
  } as DbRunner;
}

const tenantEntity = createEntity({
  table: "fw2855_global_tenant_items",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const tenantEntityTable = buildEntityTable("globalGuardTenantItem", tenantEntity);
const tenantMeta = deriveEntityTableMeta("globalGuardTenantMeta", tenantEntity);

const globalManagedEntity = createEntity({
  table: "fw2855_global_managed_items",
  tenancy: "global",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const globalManagedTable = buildEntityTable("globalGuardManagedItem", globalManagedEntity);

const globalUnmanagedTable = defineUnmanagedTable({
  tableName: "store_fw2855_global_items",
  tenancy: "global",
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "name", pgType: "text", notNull: true },
  ],
});

// Regression coverage for the tenancy-brand type hole (fw#2855 review): an
// EntityDefinition object literal (bypassing createEntity) must not be
// mis-branded "global" just because it lacks a `tenancy` property at all.
const bareLiteralTable = buildEntityTable("globalGuardBareLiteral", {
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const explicitTenantLiteralTable = buildEntityTable("globalGuardExplicitTenant", {
  tenancy: "tenant",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const explicitGlobalLiteralTable = buildEntityTable("globalGuardExplicitGlobal", {
  tenancy: "global",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const own = testTenantId(1);

// Type-only assertions — never invoked, checked by `tsc --build` only.
function typeAssertions(tdb: TenantDb): void {
  // @ts-expect-error db.global() on a "tenant"-tenancy table (default tenancy) is a type error.
  tdb.global(tenantEntityTable);

  // @ts-expect-error an EntityDefinition object literal without a `tenancy` key must not brand "global".
  tdb.global(bareLiteralTable);

  // @ts-expect-error an explicit `tenancy: "tenant"` literal must not brand "global".
  tdb.global(explicitTenantLiteralTable);

  // Compile-positive: an explicit `tenancy: "global"` literal is reachable through db.global().
  void tdb.global(explicitGlobalLiteralTable).selectMany({ name: "x" });

  // Compile-positive: an unmanaged "global" table is fully writable through db.global().
  void tdb.global(globalUnmanagedTable).insertOne({ name: "x" });

  const managedAccessor = tdb.global(globalManagedTable);
  // @ts-expect-error managed global tables stay executor-only — no write methods through db.global() either.
  void managedAccessor.insertOne({ name: "x" });
}
void typeAssertions;

describe("TenantDb.global()", () => {
  test("on a tenant-tenancy table throws AccessDeniedError at runtime (erased/unbranded table)", () => {
    const tdb = createTenantDb(unreachableRunner(), own);
    expect(() =>
      tdb.global(tenantMeta as unknown as EntityTableMeta & TenancyBrand<"global">),
    ).toThrow(/tenancy: "global"/);
  });

  test("reads on a global table never touch the caller's tenant filter", async () => {
    const captured: { sql: string; values: readonly unknown[] }[] = [];
    const db: DbRunner = {
      unsafe: async (sql: string, values: readonly unknown[]) => {
        captured.push({ sql, values });
        return [];
      },
      begin: async () => {
        throw new Error("begin not used in this test");
      },
    } as DbRunner;
    const tdb = createTenantDb(db, own);
    await tdb.global(globalUnmanagedTable).selectMany({ name: "x" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).not.toMatch(/tenant_id/i);
  });

  test("write without escapeHatch rejects before touching the runner", async () => {
    const tdb = createTenantDb(unreachableRunner(), own);
    await expect(tdb.global(globalUnmanagedTable).insertOne({ name: "x" })).rejects.toThrow(
      /escapeHatch/,
    );
  });

  test("write with an empty-reason escapeHatch rejects before touching the runner", async () => {
    const tdb = createTenantDb(
      unreachableRunner(),
      own,
      "tenant",
      undefined,
      undefined,
      undefined,
      {
        reason: "   ",
      },
    );
    await expect(tdb.global(globalUnmanagedTable).insertOne({ name: "x" })).rejects.toThrow(
      /escapeHatch/,
    );
  });

  test("write with a non-empty escapeHatch reason reaches the runner", async () => {
    const captured: { sql: string }[] = [];
    const db: DbRunner = {
      unsafe: async (sql: string) => {
        captured.push({ sql });
        return [{ id: "x" }];
      },
      begin: async () => {
        throw new Error("begin not used in this test");
      },
    } as DbRunner;
    const tdb = createTenantDb(db, own, "tenant", undefined, undefined, undefined, {
      reason: "cross-tenant backfill job",
    });
    await tdb.global(globalUnmanagedTable).insertOne({ name: "x" });
    expect(captured).toHaveLength(1);
  });
});

describe("UncheckedSystemDb.unsafeRaw", () => {
  test("throws on an empty or whitespace-only reason", () => {
    const tdb = createTenantDb(unreachableRunner(), own);
    const sysDb = createUncheckedSystemDb(tdb);
    expect(() => sysDb.unsafeRaw("")).toThrow();
    expect(() => sysDb.unsafeRaw("   ")).toThrow();
  });

  test("returns the underlying DbRunner for a non-empty reason", () => {
    const rawDb = unreachableRunner();
    const tdb = createTenantDb(rawDb, own);
    const sysDb = createUncheckedSystemDb(tdb);
    expect(sysDb.unsafeRaw("cleanup job")).toBe(rawDb);
  });
});
