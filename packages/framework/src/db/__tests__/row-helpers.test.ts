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
const fakeWhere = {} as SQL;

describe("fetchOne", () => {
  test("returns the first row when the query yields at least one match", async () => {
    const { db } = makeFakeDb([{ id: 1, name: "alice" }, { id: 2, name: "bob" }]);
    const row = await fetchOne<{ id: number; name: string }>(db, fakeTable, fakeWhere);
    expect(row).toEqual({ id: 1, name: "alice" });
  });

  test("returns undefined on an empty result", async () => {
    const { db } = makeFakeDb([]);
    const row = await fetchOne(db, fakeTable, fakeWhere);
    expect(row).toBeUndefined();
  });

  test("applies limit(1) — no need to pull the whole table", async () => {
    const { db, limit } = makeFakeDb([]);
    await fetchOne(db, fakeTable, fakeWhere);
    expect(limit).toHaveBeenCalledWith(1);
  });
});
