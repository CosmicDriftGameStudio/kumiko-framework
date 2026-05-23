import type { SQL } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { fetchOne } from "../row-helpers";

// Drizzle builder chain mocked structurally — fetchOne only calls
// db.select().from(table).where(where).limit(1) and reads the first row.
function makeFakeDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  // biome-ignore lint/suspicious/noExplicitAny: test shim — we never feed this to a real DbRunner type check.
  return { db: { select } as any, select, from, where, limit };
}

const fakeTable = {} as never;
// drizzle's SQL-AST hat queryChunks + getSQL(); WhereObject-Discriminator
// in fetchOne unterscheidet sie strukturell — Test-mocks müssen einen der
// beiden marker tragen damit der dispatcher den AST-Pfad nimmt.
const fakeCond1 = { __c: 1, queryChunks: [] } as unknown as SQL;
const fakeCond2 = { __c: 2, queryChunks: [] } as unknown as SQL;

describe("fetchOne", () => {
  test("returns the first row when the query yields at least one match", async () => {
    const { db } = makeFakeDb([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
    const row = await fetchOne<{ id: number; name: string }>(db, fakeTable, fakeCond1);
    expect(row).toEqual({ id: 1, name: "alice" });
  });

  test("returns undefined on an empty result", async () => {
    const { db } = makeFakeDb([]);
    const row = await fetchOne(db, fakeTable, fakeCond1);
    expect(row).toBeUndefined();
  });

  test("applies limit(1) — no need to pull the whole table", async () => {
    const { db, limit } = makeFakeDb([]);
    await fetchOne(db, fakeTable, fakeCond1);
    expect(limit).toHaveBeenCalledWith(1);
  });

  test("passes the single condition directly to .where (no AND wrapping)", async () => {
    const { db, where } = makeFakeDb([]);
    await fetchOne(db, fakeTable, fakeCond1);
    expect(where).toHaveBeenCalledWith(fakeCond1);
  });

  test("combines multiple conditions with AND", async () => {
    const { db, where } = makeFakeDb([]);
    await fetchOne(db, fakeTable, fakeCond1, fakeCond2);
    const calls = where.mock.calls as unknown as readonly (readonly unknown[])[];
    const arg = calls[0]?.[0];
    // drizzle's and() returns an SQL expression — we can't cheaply inspect
    // its innards, but it must not be the raw first condition and must be
    // defined (i.e. the helper actually composed something).
    expect(arg).toBeDefined();
    expect(arg).not.toBe(fakeCond1);
  });
});
