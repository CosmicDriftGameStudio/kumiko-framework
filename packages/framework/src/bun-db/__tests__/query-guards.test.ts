import { describe, expect, test } from "bun:test";
import { incrementCounter, selectMany } from "../query";

const meta = {
  source: "unmanaged" as const,
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
  // A TenantDb-shaped handle: has .raw.unsafe + the scoped methods + tenantId.
  const tenantDb = {
    raw: { unsafe: async () => [] as unknown[] },
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
