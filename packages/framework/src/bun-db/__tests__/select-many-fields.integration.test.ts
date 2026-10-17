import { afterAll, describe, expect, test } from "bun:test";
import { insertMany, selectMany } from "../query.js";
import { closeDb, withTable } from "./_helpers.js";

afterAll(async () => {
  await closeDb();
});

const columns = [
  { name: "label", pgType: "text" as const, notNull: true },
  { name: "secret_note", pgType: "text" as const, notNull: false },
  { name: "score", pgType: "integer" as const, notNull: true },
] as const;

describe("selectMany — fields projection", () => {
  test("returns only the requested keys", async () => {
    await withTable(columns, async ({ db, meta }) => {
      await insertMany(db, meta, [{ label: "alpha", secretNote: "hidden", score: 1 }]);
      const rows = await selectMany<Record<string, unknown>>(db, meta, undefined, {
        fields: ["label", "score"],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ label: "alpha", score: 1 });
    });
  });

  test("filters on a column that is not projected", async () => {
    await withTable(columns, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "alpha", score: 1 },
        { label: "beta", score: 2 },
      ]);
      const rows = await selectMany<Record<string, unknown>>(
        db,
        meta,
        { score: 2 },
        { fields: ["label"] },
      );
      expect(rows).toEqual([{ label: "beta" }]);
    });
  });

  test("rejects an unknown field", async () => {
    await withTable(columns, async ({ db, meta }) => {
      await expect(selectMany(db, meta, undefined, { fields: ["label", "nope"] })).rejects.toThrow(
        /"nope" is not a column/,
      );
    });
  });

  test("rejects an empty field list", async () => {
    await withTable(columns, async ({ db, meta }) => {
      await expect(selectMany(db, meta, undefined, { fields: [] })).rejects.toThrow(
        /fields must not be empty/,
      );
    });
  });
});
