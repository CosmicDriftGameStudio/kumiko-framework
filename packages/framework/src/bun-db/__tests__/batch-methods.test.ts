import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../../db/entity-table-meta";
import { deleteManyBatched } from "../query";

describe("deleteManyBatched (mock)", () => {
  test("requires non-empty where", async () => {
    const meta: EntityTableMeta = {
      source: "unmanaged",
      tableName: "read_items",
      indexes: [],
      columns: [
        { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
        { name: "flag", pgType: "boolean", notNull: true },
      ],
    };
    const db = { unsafe: async () => [] as unknown[] };
    await expect(deleteManyBatched(db, meta, {}, { limit: 10 })).rejects.toThrow(
      "where clause required",
    );
  });
});
