import { describe, expect, test } from "bun:test";
import type { DbRunner } from "../../db/connection";
import type { EntityTableMeta } from "../../db/entity-table-meta";
import { createTenantDb } from "../../db/tenant-db";
import { testTenantId } from "../../stack";
import { asRawClient, countWhere, incrementCounter, selectMany, transaction } from "../query";

const meta: EntityTableMeta = {
  source: "unmanaged",
  tableName: "read_items",
  indexes: [],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "count", pgType: "integer", notNull: true },
  ],
};

// A db whose unsafe() blows up — proves the guard throws BEFORE any SQL runs.
const explodingDb = {
  unsafe: async () => {
    throw new Error("unsafe must not be reached when a guard rejects");
  },
};

describe("bun-db guards — limit injection", () => {
  test("selectMany rejects a non-integer limit", async () => {
    await expect(selectMany(explodingDb, meta, undefined, { limit: 1.5 })).rejects.toThrow(
      "limit must be a non-negative integer",
    );
  });

  test("selectMany rejects a negative limit", async () => {
    await expect(selectMany(explodingDb, meta, undefined, { limit: -1 })).rejects.toThrow(
      "limit must be a non-negative integer",
    );
  });
});

describe("bun-db guards — silent tenant-scope bypass", () => {
  // A TenantDb-shaped handle: the scoped methods + tenantId, no `.unsafe` of its own.
  const tenantDb = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    selectMany: async () => [],
    fetchOne: async () => undefined,
    insertOne: async () => undefined,
    updateMany: async () => [],
    deleteMany: async () => {},
  };

  test("incrementCounter refuses a tenant-scoped db (would bypass the filter)", async () => {
    await expect(
      incrementCounter(tenantDb, meta, { tenantId: tenantDb.tenantId }, { count: 1 }),
    ).rejects.toThrow("does not apply the tenant filter");
  });
});

describe("bun-db guards — a real TenantDb has no unfiltered escape via asRawClient", () => {
  const tenantId = testTenantId(1);

  // A runner whose unsafe()/begin() blow up — proves each guard throws
  // BEFORE reaching the driver, same contract as `explodingDb` above.
  function explodingRunner(): DbRunner {
    return {
      unsafe: async () => {
        throw new Error("unsafe must not be reached — asRawClient should fail closed first");
      },
      begin: async () => {
        throw new Error("begin must not be reached — asRawClient should fail closed first");
      },
    } as unknown as DbRunner;
  }

  test("asRawClient throws and points callers at ctx.db.unsafeRaw", () => {
    const tdb = createTenantDb(explodingRunner(), tenantId);
    expect(() => asRawClient(tdb)).toThrow("unsafeRaw");
  });

  test("countWhere throws before issuing any SQL", async () => {
    const tdb = createTenantDb(explodingRunner(), tenantId);
    await expect(countWhere(tdb, meta, {})).rejects.toThrow("unsafeRaw");
  });

  test("transaction throws before issuing any SQL", async () => {
    const tdb = createTenantDb(explodingRunner(), tenantId);
    await expect(transaction(tdb, async () => "unreached")).rejects.toThrow("unsafeRaw");
  });
});

describe("bun-db guards — selectMany still delegates a real TenantDb, tenant-filtered", () => {
  test("selectMany(tenantDb, ...) issues tenant-filtered SQL via the bound runner", async () => {
    const tenantId = testTenantId(2);
    const captured: { sql: string; values: readonly unknown[] }[] = [];
    const recordingRunner: DbRunner = {
      unsafe: async (sql: string, values: readonly unknown[]) => {
        captured.push({ sql, values });
        return [] as unknown[];
      },
      begin: async () => {
        throw new Error("begin not used in this test");
      },
    } as unknown as DbRunner;
    const tdb = createTenantDb(recordingRunner, tenantId);

    await selectMany(tdb, meta, {});

    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toMatch(/tenant_id/i);
    expect(captured[0]?.values).toContain(tenantId);
  });
});
