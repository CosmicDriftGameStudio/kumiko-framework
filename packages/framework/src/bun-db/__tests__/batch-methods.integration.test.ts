import { afterAll, describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../../db/entity-table-meta";
import { sql } from "../../db/dialect";
import {
  asRawClient,
  countWhere,
  deleteManyBatched,
  incrementCounter,
  insertMany,
  selectMany,
  upsertByPk,
  upsertOnConflict,
} from "../query";
import { closeDb, getDb, renderCreateTable, uniqueTableName, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

const scoreCols = [{ name: "score", pgType: "integer" as const, notNull: true, defaultSql: "0" }] as const;

function makeCodePkMeta(tableName: string): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes: [],
    columns: [
      { name: "code", pgType: "text", notNull: true, primaryKey: true },
      { name: "score", pgType: "integer", notNull: true, defaultSql: "0" },
    ],
  };
}

async function withCodeTable<T>(
  fn: (ctx: { db: unknown; meta: EntityTableMeta }) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const tableName = uniqueTableName("upsert");
  const meta = makeCodePkMeta(tableName);
  await asRawClient(db).unsafe(renderCreateTable(meta));
  try {
    return await fn({ db, meta });
  } finally {
    await asRawClient(db).unsafe(`DROP TABLE IF EXISTS "${tableName}"`);
  }
}

describe("countWhere", () => {
  test("counts all rows when where is empty", async () => {
    await withTable(scoreCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ score: 1 }, { score: 2 }]);
      expect(await countWhere(db, meta)).toBe(2);
    });
  });

  test("counts filtered rows", async () => {
    await withTable(scoreCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ score: 1 }, { score: 5 }, { score: 5 }]);
      expect(await countWhere(db, meta, { score: 5 })).toBe(2);
    });
  });
});

describe("upsertOnConflict / upsertByPk", () => {
  test("upsertByPk inserts then updates on conflict", async () => {
    await withCodeTable(async ({ db, meta }) => {
      await upsertByPk(db, meta, { code: "alpha", score: 1 });
      await upsertByPk(db, meta, { code: "alpha", score: 9 });
      const rows = await selectMany<{ code: string; score: number }>(db, meta);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.score).toBe(9);
    });
  });

  test("upsertOnConflict with explicit conflictKeys", async () => {
    await withCodeTable(async ({ db, meta }) => {
      await upsertOnConflict(db, meta, { code: "beta", score: 2 }, { conflictKeys: ["code"] });
      await upsertOnConflict(
        db,
        meta,
        { code: "beta", score: 7 },
        { conflictKeys: ["code"], update: { score: 7 } },
      );
      const row = (await selectMany<{ score: number }>(db, meta, { code: "beta" }))[0];
      expect(row?.score).toBe(7);
    });
  });
});

describe("incrementCounter", () => {
  test("atomically increments numeric columns on conflict", async () => {
    await withCodeTable(async ({ db, meta }) => {
      await incrementCounter(db, meta, { code: "t1", score: 10 }, { score: 10 });
      await incrementCounter(db, meta, { code: "t1", score: 0 }, { score: 5 });
      const row = (await selectMany<{ score: number }>(db, meta, { code: "t1" }))[0];
      expect(row?.score).toBe(15);
    });
  });

  test("supports set on conflict with sql expression", async () => {
    await withCodeTable(async ({ db, meta }) => {
      const withUpdated: EntityTableMeta = {
        ...meta,
        columns: [
          ...meta.columns,
          { name: "updated_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
        ],
      };
      await asRawClient(db).unsafe(`DROP TABLE IF EXISTS "${meta.tableName}"`);
      await asRawClient(db).unsafe(renderCreateTable(withUpdated));
      await incrementCounter(
        db,
        withUpdated,
        { code: "x", score: 1 },
        { score: 1 },
        { conflictKeys: ["code"], set: { updatedAt: sql`NOW()` } },
      );
      const rows = await selectMany(db, withUpdated, { code: "x" });
      expect(rows.length).toBe(1);
    });
  });
});

describe("deleteManyBatched", () => {
  test("deletes in chunks until no rows match", async () => {
    await withTable(scoreCols, async ({ db, meta }) => {
      await insertMany(
        db,
        meta,
        Array.from({ length: 10 }, (_, i) => ({ score: i < 7 ? 1 : 9 })),
      );
      expect(await countWhere(db, meta, { score: 1 })).toBe(7);

      const result = await deleteManyBatched(db, meta, { score: 1 }, { limit: 3 });
      expect(result.deleted).toBe(7);
      expect(result.batches).toBe(3);
      expect(await countWhere(db, meta, { score: 1 })).toBe(0);
      expect(await countWhere(db, meta, { score: 9 })).toBe(3);
    });
  });
});
