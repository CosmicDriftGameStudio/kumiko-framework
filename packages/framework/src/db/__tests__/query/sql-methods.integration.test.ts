// Behavior tests for selectMany, fetchOne, insertMany, updateMany, deleteMany and transaction.
//
// transaction() is only callable on a top-level db handle; a transaction handle cannot
// begin another one, so nested scopes are not covered here.
//
// deleteMany({}) with an empty where object renders no WHERE clause and deletes ALL rows.
// That footgun is intentional behavior and pinned by a test below.
import { afterAll, describe, expect, test } from "bun:test";
import { InternalError } from "../../../errors/index.ts";
import {
  deleteMany,
  fetchOne,
  insertMany,
  insertOne,
  selectMany,
  transaction,
  updateMany,
} from "../../query.ts";
import { closeDb, withTable } from "./_helpers.ts";

afterAll(async () => {
  await closeDb();
});

const textCols = [{ name: "val", pgType: "text" as const, notNull: true }] as const;

describe("selectMany", () => {
  test("empty table returns []", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const rows = await selectMany(db, meta);
      expect(rows).toEqual([]);
    });
  });

  test("without where returns all rows", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "a" });
      await insertOne(db, meta, { val: "b" });
      await insertOne(db, meta, { val: "c" });
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(3);
    });
  });

  test("with where filters correctly", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "match" });
      await insertOne(db, meta, { val: "no-match" });
      const rows = await selectMany(db, meta, { val: "match" });
      expect(rows.length).toBe(1);
      expect((rows[0] as { val: string }).val).toBe("match");
    });
  });

  test("orderBy asc", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "c" }, { val: "a" }, { val: "b" }]);
      const rows = (await selectMany(
        db,
        meta,
        {},
        { orderBy: { col: "val", direction: "asc" } },
      )) as readonly { val: string }[];
      expect(rows.map((r) => r.val)).toEqual(["a", "b", "c"]);
    });
  });

  test("orderBy desc", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "a" }, { val: "c" }, { val: "b" }]);
      const rows = (await selectMany(
        db,
        meta,
        {},
        { orderBy: { col: "val", direction: "desc" } },
      )) as readonly { val: string }[];
      expect(rows.map((r) => r.val)).toEqual(["c", "b", "a"]);
    });
  });

  test("limit begrenzt Anzahl Ergebnisse", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "x" }, { val: "y" }, { val: "z" }]);
      const rows = await selectMany(db, meta, {}, { limit: 2 });
      expect(rows.length).toBe(2);
    });
  });
});

describe("fetchOne", () => {
  test("returns the found row", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const inserted = await insertOne<{ id: string; val: string }>(db, meta, { val: "find-me" });
      const row = await fetchOne<{ id: string; val: string }>(db, meta, { id: inserted!.id });
      expect(row).toBeDefined();
      expect(row!.val).toBe("find-me");
    });
  });

  test("not found returns undefined", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const row = await fetchOne(db, meta, { id: "00000000-0000-4000-8000-000000000001" });
      expect(row).toBeUndefined();
    });
  });
});

describe("insertMany", () => {
  test("0 rows = no-op, returns []", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const result = await insertMany(db, meta, []);
      expect(result).toEqual([]);
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(0);
    });
  });

  test("1 row", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const result = await insertMany<{ id: string; val: string }>(db, meta, [{ val: "single" }]);
      expect(result.length).toBe(1);
      expect(result[0]!.val).toBe("single");
    });
  });

  test("inserts 5 rows at once", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const input = Array.from({ length: 5 }, (_, i) => ({ val: `row-${i}` }));
      const result = await insertMany<{ id: string; val: string }>(db, meta, input);
      expect(result.length).toBe(5);
      const all = await selectMany(db, meta);
      expect(all.length).toBe(5);
    });
  });
});

describe("updateMany", () => {
  test("zero matches return [] and make no changes", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "unchanged" });
      const result = await updateMany(
        db,
        meta,
        { val: "new" },
        { id: "00000000-0000-4000-8000-000000000001" },
      );
      expect(result).toEqual([]);
      const rows = await selectMany<{ val: string }>(db, meta);
      expect(rows[0]!.val).toBe("unchanged");
    });
  });

  test("single match updates exactly one row", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, { val: "before" });
      await updateMany(db, meta, { val: "after" }, { id: ins!.id });
      const row = await fetchOne<{ val: string }>(db, meta, { id: ins!.id });
      expect(row!.val).toBe("after");
    });
  });

  test("unknown key in the set object throws instead of being silently discarded", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, { val: "before" });
      await expect(
        updateMany(db, meta, { val: "after", stauts: "x" }, { id: ins!.id }),
      ).rejects.toThrow(/stauts/);
    });
  });

  test("multi-row update changes all matches", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "old" }, { val: "old" }, { val: "keep" }]);
      const result = await updateMany(db, meta, { val: "updated" }, { val: "old" });
      expect(result.length).toBe(2);
      const all = await selectMany<{ val: string }>(db, meta, { val: "updated" });
      expect(all.length).toBe(2);
    });
  });
});

describe("deleteMany", () => {
  test("zero matches = no changes", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertOne(db, meta, { val: "stay" });
      await deleteMany(db, meta, { id: "00000000-0000-4000-8000-000000000001" });
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(1);
    });
  });

  test("single delete removes exactly one row (verified with selectMany)", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, { val: "delete-me" });
      await insertOne(db, meta, { val: "keep" });
      await deleteMany(db, meta, { id: ins!.id });
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(1);
    });
  });

  test("deleteMany({}) deletes all rows (FOOTGUN: no WHERE clause)", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ val: "a" }, { val: "b" }, { val: "c" }]);
      await deleteMany(db, meta, {});
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(0);
    });
  });
});

describe("transaction", () => {
  test("commit: writes are visible in the DB afterwards", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await transaction(db, async (tx) => {
        await insertOne(tx, meta, { val: "committed" });
      });
      const rows = await selectMany<{ val: string }>(db, meta);
      expect(rows.length).toBe(1);
      expect(rows[0]!.val).toBe("committed");
    });
  });

  test("on a tx handle: InternalError instead of TypeError", async () => {
    await withTable(textCols, async ({ db }) => {
      await transaction(db, async (tx) => {
        await expect(transaction(tx, async () => "nested")).rejects.toBeInstanceOf(InternalError);
      });
    });
  });

  test("rollback on throw: writes are GONE (verified with selectMany)", async () => {
    await withTable(textCols, async ({ db, meta }) => {
      await expect(
        transaction(db, async (tx) => {
          await insertOne(tx, meta, { val: "should-vanish" });
          throw new Error("forced rollback");
        }),
      ).rejects.toThrow("forced rollback");
      const rows = await selectMany(db, meta);
      expect(rows.length).toBe(0);
    });
  });
});
