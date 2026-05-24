// JSONB-Edge-Cases — wo Drift zwischen bun.sql und postgres-js entstanden ist.
// Bun.SQL kann arrays/objects nicht direkt als jsonb binden; query.ts
// macht JSON.stringify + ::jsonb cast (siehe query.ts:301-306). Diese
// Tests beweisen dass dabei nichts subtil verloren geht — egal wie
// komplex/edge das jsonb-Value ist.

import { afterAll, describe, expect, test } from "bun:test";
import { fetchOne, insertOne, updateMany } from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

// Hilfsfunktion: jsonb-Spalte mit pgType + Default. NotNull damit der
// expliziter Test ist (NULL-jsonb verdeckt sonst Bind-Bugs).
const jsonbCol = (defaultSql: string) => [
  { name: "data", pgType: "jsonb" as const, notNull: true, defaultSql },
];

async function roundtripObject(db: unknown, meta: unknown, value: object): Promise<unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: tests pass any shape
  const ins = (await insertOne<any>(db as never, meta as never, { data: value }))!;
  const row = await fetchOne<{ data: unknown }>(db as never, meta as never, { id: ins.id });
  return row?.data;
}

describe("jsonb — primitive shapes", () => {
  test("nested object 3 levels deep", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { level1: { level2: { level3: "deep" } } };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("array of strings", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      const v = ["a", "b", "c"];
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("array of numbers (ints + floats)", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      const v = [1, 2.5, -3, 0, 1e10];
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("array of booleans", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      expect(await roundtripObject(db, meta, [true, false, true])).toEqual([true, false, true]);
    });
  });

  test("array of objects (rows-pattern)", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      const v = [
        { id: "1", label: "Alpha" },
        { id: "2", label: "Beta" },
      ];
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("mixed array (string|number|bool|null)", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      const v = ["x", 1, true, null, 0];
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });
});

describe("jsonb — strings inside", () => {
  test("string with double quotes (JSON-escape edge)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { note: 'He said "hello" loudly' };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("string with backslashes (Windows path)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { path: "C:\\Users\\marc\\Documents" };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("string with newlines + tabs", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { body: "line1\nline2\tcol2" };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("string with Unicode + emoji", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { name: "Müller", flag: "🇩🇪", chinese: "你好" };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("Stripe-style IDs", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = {
        subscription: "sub_1Nq1qY2eZvKYlo2C0",
        event: "evt_1Nq1qY2eZvKYlo2C0",
        customer: "cus_1234567890",
      };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("string with single quotes (SQL-injection-shape)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { malicious: "'; DROP TABLE users; --" };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("empty string + null distinction inside object", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { empty: "", missing: null };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });
});

describe("jsonb — numbers + special", () => {
  test("bigint-grenzen als number (in JSON)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      // JSON nicht bigint-fähig, aber 2^53-1 ist max safe integer in JS
      const v = { large: 9007199254740991, negativeLarge: -9007199254740991 };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("floats with precision", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { pi: 3.141592653589793, small: 0.0001 };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("ISO date strings stay strings (NOT auto-parsed to Date)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      // Wichtig: bun-db darf String-Werte in jsonb nicht zu Date coercen.
      const v = { iso: "2026-05-24T08:30:00.000Z" };
      const out = (await roundtripObject(db, meta, v)) as { iso: unknown };
      expect(typeof out.iso).toBe("string");
      expect(out.iso).toBe(v.iso);
    });
  });
});

describe("jsonb — booleans + null", () => {
  test("boolean field inside object", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { active: true, deleted: false };
      const out = (await roundtripObject(db, meta, v)) as { active: unknown; deleted: unknown };
      // typeof-Check verhindert "true"-string-statt-bool-Drift
      expect(typeof out.active).toBe("boolean");
      expect(typeof out.deleted).toBe("boolean");
      expect(out.active).toBe(true);
      expect(out.deleted).toBe(false);
    });
  });

  test("null-value in object", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v = { missing: null, present: "x" };
      const out = (await roundtripObject(db, meta, v)) as { missing: unknown };
      expect(out.missing).toBeNull();
      expect(out).toEqual(v);
    });
  });
});

describe("jsonb — large + deeply nested", () => {
  test("large object (~10KB)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const v: Record<string, string> = {};
      for (let i = 0; i < 100; i++) v[`k${i}`] = `value-${i}-${"x".repeat(50)}`;
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("deeply nested (10 levels)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      let v: object = { leaf: "bottom" };
      for (let i = 0; i < 10; i++) v = { [`level${i}`]: v };
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });

  test("array of 50 objects", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      const v = Array.from({ length: 50 }, (_, i) => ({
        idx: i,
        label: `row-${i}`,
        flag: i % 2 === 0,
      }));
      expect(await roundtripObject(db, meta, v)).toEqual(v);
    });
  });
});

describe("jsonb — UPDATE roundtrip (separate from INSERT)", () => {
  test("UPDATE replaces jsonb value entirely (not merge)", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const ins = (await insertOne<{ id: string }>(db, meta, { data: { a: 1, b: 2 } }))!;
      await updateMany(db, meta, { data: { c: 3 } }, { id: ins.id });
      const row = await fetchOne<{ data: unknown }>(db, meta, { id: ins.id });
      expect(row?.data).toEqual({ c: 3 });
    });
  });

  test("UPDATE with array value replaces full array", async () => {
    await withTable(jsonbCol("'[]'::jsonb"), async ({ db, meta }) => {
      const ins = (await insertOne<{ id: string }>(db, meta, { data: [1, 2, 3] }))!;
      await updateMany(db, meta, { data: ["a", "b"] }, { id: ins.id });
      const row = await fetchOne<{ data: unknown }>(db, meta, { id: ins.id });
      expect(row?.data).toEqual(["a", "b"]);
    });
  });

  test("UPDATE with empty {} → leeres Objekt überschrieben", async () => {
    await withTable(jsonbCol("'{}'::jsonb"), async ({ db, meta }) => {
      const ins = (await insertOne<{ id: string }>(db, meta, { data: { foo: "bar" } }))!;
      await updateMany(db, meta, { data: {} }, { id: ins.id });
      const row = await fetchOne<{ data: unknown }>(db, meta, { id: ins.id });
      expect(row?.data).toEqual({});
    });
  });
});
