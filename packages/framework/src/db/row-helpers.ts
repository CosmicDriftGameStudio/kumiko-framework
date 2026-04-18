import type { SQL } from "drizzle-orm";
import type { DbRow } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Mirrors the erased ProjectionTable / event-store-executor pattern — the framework doesn't know user column shapes.
type AnyTable = TableColumns<any>;

// Minimal DB surface fetchOne uses — structurally satisfied by raw DbRunner
// (connection / tx) AND TenantDb (tenant-scoped wrapper). Both expose the
// same `select().from().where().limit()` chain with compatible rows, so the
// helper types against the shared shape instead of a union that TS can't
// narrow cleanly.
type SelectChainDb = {
  select: () => {
    from: (table: AnyTable) => {
      where: (cond: SQL | undefined) => {
        limit: (n: number) => PromiseLike<readonly Record<string, unknown>[]>;
      };
    };
  };
};

// SELECT * FROM <table> WHERE <where> LIMIT 1 → first row or undefined.
// Collapses the "const [row] = await db.select()...limit(1)" destructure
// that repeats in every detail-query-style handler and in existence-checks
// before write. The raw row type is `DbRow` (the framework's erased
// Record<string, unknown>); pass an explicit TRow generic when the caller
// knows the shape.
//
//   const existing = await fetchOne<{ id: number }>(db, userTable,
//     eq(userTable.email, payload.email));
//   if (existing) return writeFailure(new ConflictError({ ... }));
//
// For existence-only checks, call `(await fetchOne(...)) !== undefined`
// — no separate helper, one less name to remember.
export async function fetchOne<TRow = DbRow>(
  db: SelectChainDb,
  table: AnyTable,
  // `where` accepts the same `SQL | undefined` shape drizzle's own .where()
  // exposes, so `and(cond1, cond2)` (which can widen to undefined when all
  // conditions are undefined) drops in without a non-null assertion.
  where: SQL | undefined,
): Promise<TRow | undefined> {
  const rows = await db.select().from(table).where(where).limit(1);
  return rows[0] as TRow | undefined;
}
