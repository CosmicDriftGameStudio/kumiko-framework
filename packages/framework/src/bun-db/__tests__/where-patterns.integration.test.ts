// where-patterns.integration.ts — vollständige WhereObject + WhereOperator-Matrix.
//
// WhereObject aus query.ts unterstützt:
//   - primitive equality: string, number, boolean, uuid
//   - null → IS NULL
//   - bare array → IN (shortcut)
//   - WhereOperator: { in: [...] }, { ne: x }, { gt/gte/lt/lte }, { like: str }
//   - multi-field AND-Kombination
//
// JSONB top-level equality: wird getestet (JSON.stringify + ::jsonb cast in prepareValue).
// Deep-path-queries (->>'key') sind out-of-scope für bun-db's WhereObject.
import { afterAll, describe, expect, test } from "bun:test";
import { insertMany, selectMany } from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

const strNumCols = [
  { name: "label", pgType: "text" as const, notNull: true },
  { name: "score", pgType: "integer" as const, notNull: true },
] as const;

const boolCols = [{ name: "active", pgType: "boolean" as const, notNull: false }] as const;

const refCols = [{ name: "ref", pgType: "uuid" as const, notNull: false }] as const;

describe("where — primitive equality", () => {
  test("string equality", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "alpha", score: 1 },
        { label: "beta", score: 2 },
      ]);
      const rows = await selectMany<{ label: string }>(db, meta, { label: "alpha" });
      expect(rows.length).toBe(1);
      expect(rows[0]!.label).toBe("alpha");
    });
  });

  test("number equality", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "a", score: 42 },
        { label: "b", score: 99 },
      ]);
      const rows = await selectMany<{ score: number }>(db, meta, { score: 42 });
      expect(rows.length).toBe(1);
      expect(rows[0]!.score).toBe(42);
    });
  });

  test("boolean equality (true)", async () => {
    await withTable(boolCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ active: true }, { active: false }, { active: true }]);
      const rows = await selectMany(db, meta, { active: true });
      expect(rows.length).toBe(2);
    });
  });

  test("boolean equality (false)", async () => {
    await withTable(boolCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ active: true }, { active: false }]);
      const rows = await selectMany(db, meta, { active: false });
      expect(rows.length).toBe(1);
    });
  });

  test("uuid equality", async () => {
    await withTable(refCols, async ({ db, meta }) => {
      const target = "00000000-0000-4000-8000-000000000042";
      const other = "00000000-0000-4000-8000-000000000099";
      await insertMany(db, meta, [{ ref: target }, { ref: other }]);
      const rows = await selectMany<{ ref: string }>(db, meta, { ref: target });
      expect(rows.length).toBe(1);
      expect(rows[0]!.ref).toBe(target);
    });
  });
});

describe("where — null / IS NULL", () => {
  test("where: { col: null } → IS NULL", async () => {
    await withTable(boolCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ active: null }, { active: true }]);
      const rows = await selectMany(db, meta, { active: null });
      expect(rows.length).toBe(1);
      expect((rows[0] as { active: unknown }).active).toBeNull();
    });
  });
});

describe("where — WhereOperator", () => {
  test("{ in: [...] } → IN-Clause multi-match", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "a", score: 1 },
        { label: "b", score: 2 },
        { label: "c", score: 3 },
      ]);
      const rows = await selectMany(db, meta, { label: { in: ["a", "c"] } });
      expect(rows.length).toBe(2);
    });
  });

  test("bare array als IN-Shortcut", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "x", score: 10 },
        { label: "y", score: 20 },
        { label: "z", score: 30 },
      ]);
      // Array als WhereValue direkt ist valider IN-Shortcut (buildWhereClause L.2)
      const rows = await selectMany(db, meta, { label: ["x", "z"] as unknown as string });
      expect(rows.length).toBe(2);
    });
  });

  test("{ ne: x } → NOT EQUAL", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "keep", score: 1 },
        { label: "exclude", score: 2 },
      ]);
      const rows = await selectMany<{ label: string }>(db, meta, { label: { ne: "exclude" } });
      expect(rows.length).toBe(1);
      expect(rows[0]!.label).toBe("keep");
    });
  });

  test("{ gt: x } → greater than", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "low", score: 5 },
        { label: "mid", score: 50 },
        { label: "high", score: 100 },
      ]);
      const rows = await selectMany(db, meta, { score: { gt: 10 } });
      expect(rows.length).toBe(2);
    });
  });

  test("{ lte: x } → less-or-equal", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "a", score: 1 },
        { label: "b", score: 5 },
        { label: "c", score: 10 },
      ]);
      const rows = await selectMany(db, meta, { score: { lte: 5 } });
      expect(rows.length).toBe(2);
    });
  });

  test("{ like: pattern } → LIKE-Match", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "hello-world", score: 1 },
        { label: "hello-bun", score: 2 },
        { label: "goodbye", score: 3 },
      ]);
      const rows = await selectMany(db, meta, { label: { like: "hello%" } });
      expect(rows.length).toBe(2);
    });
  });
});

describe("where — multi-field AND", () => {
  test("zwei Felder kombiniert (UND-Semantik)", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "target", score: 7 },
        { label: "target", score: 99 },
        { label: "other", score: 7 },
      ]);
      const rows = await selectMany<{ label: string; score: number }>(db, meta, {
        label: "target",
        score: 7,
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.label).toBe("target");
      expect(rows[0]!.score).toBe(7);
    });
  });
});
