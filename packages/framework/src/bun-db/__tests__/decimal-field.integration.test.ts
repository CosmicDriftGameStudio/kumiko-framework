// decimal-field.integration.ts — real-DB roundtrip for the numeric(p,s) column.
//
// The unit tests prove the read codec (coerceRow) and the DDL/Zod in isolation.
// Only a live Postgres can prove the *write* direction: that a JS number binds
// into a numeric(p,s) column and comes back — via pg's numeric STRING + the
// coerceRow parse — as the exact same JS number. That symmetry is the thing
// that breaks silently if either side is wrong, so it gets a real DB test.
import { afterAll, describe, expect, test } from "bun:test";
import { fetchOne, insertOne } from "../query";
import { closeDb, withTable } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

const decimalCols = [
  { name: "sum", pgType: "numeric(14,2)" as const, notNull: true },
  { name: "interest", pgType: "numeric(6,4)" as const, notNull: true },
  { name: "rate", pgType: "numeric(12,2)" as const, notNull: false },
] as const;

describe("decimal — real-DB roundtrip", () => {
  test("JS number → numeric(p,s) → exact JS number", async () => {
    await withTable(decimalCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        sum: 1000.5,
        interest: 2.5,
        rate: 5.83,
      });
      const row = await fetchOne<{ sum: number; interest: number; rate: number }>(db, meta, {
        id: ins!.id,
      });
      expect(typeof row!.sum).toBe("number");
      expect(row!.sum).toBe(1000.5);
      expect(row!.interest).toBe(2.5);
      expect(row!.rate).toBe(5.83);
    });
  });

  test("negative and zero values roundtrip", async () => {
    await withTable(decimalCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        sum: -42.99,
        interest: 0,
        rate: 0.01,
      });
      const row = await fetchOne<{ sum: number; interest: number; rate: number }>(db, meta, {
        id: ins!.id,
      });
      expect(row!.sum).toBe(-42.99);
      expect(row!.interest).toBe(0);
      expect(row!.rate).toBe(0.01);
    });
  });

  test("pg enforces the scale — a fractional value beyond scale is rounded by the column", async () => {
    await withTable(decimalCols, async ({ db, meta }) => {
      // 2.55556 written into numeric(6,4) → pg rounds to 4 decimals (2.5556).
      // Proves the column constraint is real DB-side, not just Zod-advisory.
      const ins = await insertOne<{ id: string }>(db, meta, {
        sum: 100,
        interest: 2.55556,
        rate: null,
      });
      const row = await fetchOne<{ interest: number }>(db, meta, { id: ins!.id });
      expect(row!.interest).toBe(2.5556);
    });
  });

  test("null in an optional numeric column stays null", async () => {
    await withTable(decimalCols, async ({ db, meta }) => {
      const ins = await insertOne<{ id: string }>(db, meta, {
        sum: 100,
        interest: 1,
        rate: null,
      });
      const row = await fetchOne<{ rate: number | null }>(db, meta, { id: ins!.id });
      expect(row!.rate).toBeNull();
    });
  });
});
