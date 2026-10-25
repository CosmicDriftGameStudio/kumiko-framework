// Full WhereObject + WhereOperator matrix. WhereObject supports:
//   - primitive equality: string, number, boolean, uuid
//   - null → IS NULL
//   - bare array → IN (shortcut)
//   - WhereOperator: { in: [...] }, { notIn: [...] }, { ne: x }, { gt/gte/lt/lte }, { like: str }
//   - multi-field AND
//
// JSONB top-level equality is covered (JSON.stringify + ::jsonb cast in prepareValue).
// Deep-path queries (->>'key') are out of scope for WhereObject.
import { afterAll, describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { sql } from "../../dialect.ts";
import { asRawClient, insertMany, selectMany } from "../../query.ts";
import { closeDb, withTable } from "./_helpers.ts";

afterAll(async () => {
  await closeDb();
});

const strNumCols = [
  { name: "label", pgType: "text" as const, notNull: true },
  { name: "score", pgType: "integer" as const, notNull: true },
] as const;

const boolCols = [{ name: "active", pgType: "boolean" as const, notNull: false }] as const;

const refCols = [{ name: "ref", pgType: "uuid" as const, notNull: false }] as const;

const dateCols = [{ name: "day", pgType: "date" as const, notNull: true }] as const;

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

  test("{ notIn: [...] } → NOT IN, empty list excludes nothing", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "a", score: 1 },
        { label: "b", score: 2 },
        { label: "c", score: 3 },
      ]);
      const labelsOf = async (where: Record<string, unknown>) =>
        (await selectMany<{ label: string }>(db, meta, where)).map((r) => r.label).sort();

      expect(await labelsOf({ label: { notIn: ["a", "c"] } })).toEqual(["b"]);
      expect(await labelsOf({ label: { notIn: [] } })).toEqual(["a", "b", "c"]);
    });
  });

  test("bare array as IN shortcut", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "x", score: 10 },
        { label: "y", score: 20 },
        { label: "z", score: 30 },
      ]);
      // An array passed directly as a WhereValue is a valid `IN` shortcut.
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

describe("where — date column", () => {
  test("plain 'yyyy-mm-dd' string equality matches the seeded row", async () => {
    await withTable(dateCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ day: "2026-03-15" }, { day: "2026-03-16" }]);
      const rows = await selectMany(db, meta, { day: "2026-03-15" });
      expect(rows.length).toBe(1);
    });
  });

  test("Temporal.Instant filter value still matches (compatibility for existing callers)", async () => {
    // Before this fix, `date` was TIMESTAMPTZ and callers built where-filters
    // with a Temporal.Instant (e.g. Temporal.Now.instant()). prepareValue
    // anchors it at UTC before binding, so existing filter code doesn't
    // start silently matching nothing (or throwing) after the column
    // becomes a real `date`.
    await withTable(dateCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ day: "2026-03-15" }, { day: "2026-03-16" }]);
      const rows = await selectMany(db, meta, {
        day: Temporal.Instant.from("2026-03-15T00:00:00Z") as unknown as string,
      });
      expect(rows.length).toBe(1);
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

describe("where — ordering/pattern operators on a jsonb option array", () => {
  const jsonbCols = [{ name: "tags", pgType: "jsonb" as const, notNull: true }] as const;

  test("lt/gt/lte/gte match nothing and like does not crash", async () => {
    await withTable(jsonbCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ tags: ["a"] }, { tags: ["b"] }]);
      for (const op of ["lt", "gt", "lte", "gte", "like"] as const) {
        const rows = await selectMany(db, meta, { tags: { [op]: "a" } });
        expect(rows).toEqual([]);
      }
    });
  });
});

describe("where — scalar filter on a jsonb column holding scalars", () => {
  const jsonbCols = [
    { name: "label", pgType: "text" as const, notNull: true },
    { name: "flag", pgType: "jsonb" as const, notNull: true },
  ] as const;

  test("eq, in and ne still match the stored scalar exactly", async () => {
    await withTable(jsonbCols, async ({ db, meta }) => {
      await asRawClient(db).unsafe(
        `INSERT INTO "${meta.tableName}" ("id", "label", "flag") VALUES
           (gen_random_uuid(), 'on', 'true'::jsonb),
           (gen_random_uuid(), 'off', 'false'::jsonb),
           (gen_random_uuid(), 'word', '"x"'::jsonb)`,
      );
      const labelsOf = async (where: Record<string, unknown>) =>
        (await selectMany<{ label: string }>(db, meta, where)).map((r) => r.label).sort();

      expect(await labelsOf({ flag: true })).toEqual(["on"]);
      expect(await labelsOf({ flag: "x" })).toEqual(["word"]);
      expect(await labelsOf({ flag: { in: [true, "x"] } })).toEqual(["on", "word"]);
      expect(await labelsOf({ flag: { ne: true } })).toEqual(["off", "word"]);
    });
  });
});

describe("where — empty lists and null operators", () => {
  const nullableLabelCols = [
    { name: "label", pgType: "text" as const, notNull: false },
    { name: "score", pgType: "integer" as const, notNull: true },
  ] as const;

  test("empty bare array and empty { in: [] } match nothing", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ label: "a", score: 1 }]);
      expect(await selectMany(db, meta, { score: [] })).toEqual([]);
      expect(await selectMany(db, meta, { score: { in: [] } })).toEqual([]);
    });
  });

  test("{ ne: null } matches exactly the non-null rows", async () => {
    await withTable(nullableLabelCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "a", score: 1 },
        { label: null, score: 2 },
        { label: "c", score: 3 },
      ]);
      const rows = await selectMany<{ label: string }>(db, meta, { label: { ne: null } });
      expect(rows.map((r) => r.label).sort()).toEqual(["a", "c"]);
    });
  });
});

describe("where — sql expression as literal", () => {
  test("literal works in arrays, in/notIn, comparisons and equality", async () => {
    await withTable(strNumCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "a", score: 1 },
        { label: "b", score: 2 },
        { label: "c", score: 3 },
      ]);
      const labelsOf = async (where: Record<string, unknown>) =>
        (await selectMany<{ label: string }>(db, meta, where)).map((r) => r.label).sort();

      expect(await labelsOf({ score: [sql`1`, sql`3`] })).toEqual(["a", "c"]);
      expect(await labelsOf({ score: { in: [sql`2`] } })).toEqual(["b"]);
      expect(await labelsOf({ score: { notIn: [sql`2`] } })).toEqual(["a", "c"]);
      expect(await labelsOf({ score: { gt: sql`1` } })).toEqual(["b", "c"]);
      expect(await labelsOf({ score: sql`2` })).toEqual(["b"]);
    });
  });
});

describe("where — jsonb option array filters", () => {
  const tagCols = [
    { name: "label", pgType: "text" as const, notNull: true },
    { name: "tags", pgType: "jsonb" as const, notNull: true },
  ] as const;

  test("bare array matches rows containing any of the values", async () => {
    await withTable(tagCols, async ({ db, meta }) => {
      await insertMany(db, meta, [
        { label: "x", tags: ["a"] },
        { label: "y", tags: ["b", "c"] },
        { label: "z", tags: ["c"] },
      ]);
      const rows = await selectMany<{ label: string }>(db, meta, { tags: ["a", "b"] });
      expect(rows.map((r) => r.label).sort()).toEqual(["x", "y"]);
    });
  });

  test("{ ne: [] } matches nothing", async () => {
    await withTable(tagCols, async ({ db, meta }) => {
      await insertMany(db, meta, [{ label: "x", tags: ["a"] }]);
      expect(await selectMany(db, meta, { tags: { ne: [] } })).toEqual([]);
    });
  });

  test("{ notIn } is rejected", async () => {
    await withTable(tagCols, async ({ db, meta }) => {
      await expect(selectMany(db, meta, { tags: { notIn: ["a"] } })).rejects.toThrow(
        'where: notIn is not supported on jsonb column "tags"',
      );
    });
  });
});
