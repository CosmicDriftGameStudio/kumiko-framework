import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../../db/entity-table-meta.js";
import { aggregateWhere } from "../query.js";

const meta: EntityTableMeta = {
  source: "unmanaged",
  tableName: "store_aggregate_guard_items",
  indexes: [],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "status", pgType: "text", notNull: true },
    { name: "amount", pgType: "integer", notNull: true },
    { name: "created_at", pgType: "timestamptz", notNull: true },
  ],
};

const explodingDb = {
  unsafe: async () => {
    throw new Error("unsafe must not be reached when a guard rejects");
  },
};

describe("aggregateWhere — validation runs before any SQL", () => {
  test("rejects an unknown measure field", async () => {
    await expect(
      aggregateWhere(explodingDb, meta, { measure: { fn: "sum", field: "nope" } }),
    ).rejects.toThrow('measure field "nope" is not a column');
  });

  test("rejects an unknown groupBy field instead of guessing a snake_case column", async () => {
    await expect(
      aggregateWhere(explodingDb, meta, { measure: { fn: "count" }, groupBy: [{ field: "stat" }] }),
    ).rejects.toThrow('groupBy field "stat" is not a column');
  });

  test("rejects a bucket on a non-timestamptz column", async () => {
    await expect(
      aggregateWhere(explodingDb, meta, {
        measure: { fn: "count" },
        groupBy: [{ field: "status", bucket: "day", timeZone: "UTC" }],
      }),
    ).rejects.toThrow("requires a timestamptz column");
  });

  test("rejects a bucket unit outside the closed union", async () => {
    await expect(
      aggregateWhere(explodingDb, meta, {
        measure: { fn: "count" },
        groupBy: [
          // @ts-expect-error runtime guard for untyped callers
          { field: "createdAt", bucket: "day'; DROP TABLE x; --", timeZone: "UTC" },
        ],
      }),
    ).rejects.toThrow("unknown bucket");
  });

  test("rejects a non-integer or negative limit", async () => {
    await expect(
      aggregateWhere(explodingDb, meta, { measure: { fn: "count" }, limit: 1.5 }),
    ).rejects.toThrow("limit must be a non-negative integer");
    await expect(
      aggregateWhere(explodingDb, meta, { measure: { fn: "count" }, limit: -1 }),
    ).rejects.toThrow("limit must be a non-negative integer");
  });
});
