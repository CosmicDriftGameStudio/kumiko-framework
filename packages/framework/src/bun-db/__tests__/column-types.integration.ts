// Column-Type-Roundtrip-Matrix: jeder pgType, der von Bun.SQL über
// bun-db unterstützt werden muss — insert + fetch + JS-Wert-Vergleich.
//
// Beweist dass jeder Spalten-Typ aus EntityTableMeta in den bun-db
// query-layer rein- und rausgeht ohne dass JS-Werte sich subtil ändern
// (Type-coercion-bug, BigInt-precision-loss, jsonb-string-statt-object,
// Temporal-Drift bei timestamptz, etc.).

import { afterAll, describe, expect, test } from "bun:test";
import { fetchOne, insertOne } from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

describe("column-type roundtrip", () => {
  test("text", async () => {
    await withTable([{ name: "val", pgType: "text", notNull: true }], async ({ db, meta }) => {
      const ins = await insertOne<{ id: string; val: string }>(db, meta, { val: "hello" });
      const row = await fetchOne<{ id: string; val: string }>(db, meta, { id: ins!.id });
      expect(row?.val).toBe("hello");
    });
  });

  test("text with unicode + emoji", async () => {
    await withTable([{ name: "val", pgType: "text", notNull: true }], async ({ db, meta }) => {
      const ins = await insertOne<{ id: string; val: string }>(db, meta, {
        val: "Müller 🦊 中文",
      });
      const row = await fetchOne<{ id: string; val: string }>(db, meta, { id: ins!.id });
      expect(row?.val).toBe("Müller 🦊 中文");
    });
  });

  test("text empty string (not null)", async () => {
    await withTable([{ name: "val", pgType: "text", notNull: false }], async ({ db, meta }) => {
      const ins = await insertOne<{ id: string; val: string }>(db, meta, { val: "" });
      const row = await fetchOne<{ id: string; val: string }>(db, meta, { id: ins!.id });
      expect(row?.val).toBe("");
    });
  });

  test("text null in nullable column", async () => {
    await withTable([{ name: "val", pgType: "text", notNull: false }], async ({ db, meta }) => {
      const ins = await insertOne<{ id: string; val: string | null }>(db, meta, { val: null });
      const row = await fetchOne<{ id: string; val: string | null }>(db, meta, { id: ins!.id });
      expect(row?.val).toBeNull();
    });
  });

  test("boolean true + false", async () => {
    await withTable([{ name: "flag", pgType: "boolean", notNull: true }], async ({ db, meta }) => {
      const t = await insertOne<{ id: string; flag: boolean }>(db, meta, { flag: true });
      const f = await insertOne<{ id: string; flag: boolean }>(db, meta, { flag: false });
      const tr = await fetchOne<{ flag: boolean }>(db, meta, { id: t!.id });
      const fr = await fetchOne<{ flag: boolean }>(db, meta, { id: f!.id });
      expect(tr?.flag).toBe(true);
      expect(fr?.flag).toBe(false);
    });
  });

  test("integer ±max", async () => {
    await withTable(
      [{ name: "n", pgType: "integer", notNull: true }],
      async ({ db, meta }) => {
        const max = await insertOne<{ id: string; n: number }>(db, meta, { n: 2147483647 });
        const min = await insertOne<{ id: string; n: number }>(db, meta, { n: -2147483648 });
        const zero = await insertOne<{ id: string; n: number }>(db, meta, { n: 0 });
        expect((await fetchOne<{ n: number }>(db, meta, { id: max!.id }))?.n).toBe(2147483647);
        expect((await fetchOne<{ n: number }>(db, meta, { id: min!.id }))?.n).toBe(-2147483648);
        expect((await fetchOne<{ n: number }>(db, meta, { id: zero!.id }))?.n).toBe(0);
      },
    );
  });

  test("bigint ±max (as bigint)", async () => {
    await withTable(
      [{ name: "n", pgType: "bigint", notNull: true }],
      async ({ db, meta }) => {
        // JS Number-Max = 2^53-1. Postgres bigint = ±2^63-1.
        // bun-db boundary coerziert string→bigint (siehe commit 0be2db9b).
        const bigPos = 9007199254740993n;
        const ins = await insertOne<{ id: string; n: bigint }>(db, meta, { n: bigPos });
        const row = await fetchOne<{ id: string; n: bigint }>(db, meta, { id: ins!.id });
        expect(row?.n).toBe(bigPos);
      },
    );
  });

  test("uuid roundtrip", async () => {
    await withTable([{ name: "ref", pgType: "uuid", notNull: true }], async ({ db, meta }) => {
      const target = "00000000-0000-4000-8000-000000000001";
      const ins = await insertOne<{ id: string; ref: string }>(db, meta, { ref: target });
      const row = await fetchOne<{ ref: string }>(db, meta, { id: ins!.id });
      expect(row?.ref).toBe(target);
    });
  });

  test("timestamptz roundtrip via ISO string", async () => {
    await withTable(
      [{ name: "ts", pgType: "timestamptz", notNull: true }],
      async ({ db, meta }) => {
        const iso = "2026-05-24T08:30:00.000Z";
        const ins = await insertOne<{ id: string; ts: unknown }>(db, meta, { ts: iso });
        const row = await fetchOne<{ id: string; ts: Date | string }>(db, meta, { id: ins!.id });
        // bun-db gibt Temporal.Instant zurück (siehe ec2c7fbf). Wir
        // checken über instant.toString() bzw. Date-equivalence.
        const fetched = row?.ts;
        const ms =
          fetched instanceof Date
            ? fetched.getTime()
            : new Date(String(fetched)).getTime();
        expect(ms).toBe(new Date(iso).getTime());
      },
    );
  });

  test("jsonb empty object", async () => {
    await withTable(
      [{ name: "data", pgType: "jsonb", notNull: true, defaultSql: "'{}'::jsonb" }],
      async ({ db, meta }) => {
        const ins = await insertOne<{ id: string; data: object }>(db, meta, { data: {} });
        const row = await fetchOne<{ data: object }>(db, meta, { id: ins!.id });
        expect(row?.data).toEqual({});
      },
    );
  });

  test("jsonb empty array", async () => {
    await withTable(
      [{ name: "data", pgType: "jsonb", notNull: true, defaultSql: "'[]'::jsonb" }],
      async ({ db, meta }) => {
        const ins = await insertOne<{ id: string; data: unknown[] }>(db, meta, { data: [] });
        const row = await fetchOne<{ data: unknown[] }>(db, meta, { id: ins!.id });
        expect(row?.data).toEqual([]);
      },
    );
  });
});
