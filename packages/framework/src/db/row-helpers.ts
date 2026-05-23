import { and, eq, type SQL } from "drizzle-orm";
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

// SELECT * FROM <table> WHERE <...conditions> LIMIT 1 → first row or undefined.
// Collapses the "const [row] = await db.select()...limit(1)" destructure
// that repeats in every detail-query-style handler and existence-check.
//
// Conditions are variadic and non-empty — the tuple `[SQL, ...SQL[]]` rejects
// `fetchOne(db, table)` (would silently pick any row) and `fetchOne(db, table,
// undefined)` (would do the same) at compile time. Multiple conditions are
// combined with AND.
//
//   const existing = await fetchOne<{ id: number }>(db, userTable,
//     eq(userTable.email, payload.email));
//   if (existing) return writeFailure(new ConflictError({ ... }));
//
//   const row = await fetchOne(db, membershipTable,
//     eq(membershipTable.userId, userId),
//     eq(membershipTable.tenantId, tenantId),
//   );
//
// For dynamic condition arrays (length known only at runtime), spread
// explicitly: `fetchOne(db, table, first, ...rest)`. Raw `...arr` with
// `arr: SQL[]` won't type-check because TS can't prove the array is non-
// empty — a feature, not a bug.
// Object-where shorthand: `fetchOne<T>(db, table, { col: val, col2: val2 })`
// kombiniert die keys mit AND. Wird genutzt um App-Code von direct-drizzle-
// imports (eq, and) zu befreien — App-Author kennt nur framework-helpers
// + entity-tables. Internal nutzt fetchOne weiter drizzle.
export type WhereObject = Record<string, unknown>;

export async function fetchOne<TRow = DbRow>(
  db: SelectChainDb,
  table: AnyTable,
  where: WhereObject,
): Promise<TRow | undefined>;
export async function fetchOne<TRow = DbRow>(
  db: SelectChainDb,
  table: AnyTable,
  ...conditions: readonly [SQL, ...SQL[]]
): Promise<TRow | undefined>;
export async function fetchOne<TRow = DbRow>(
  db: SelectChainDb,
  table: AnyTable,
  ...args: readonly [SQL | WhereObject, ...SQL[]]
): Promise<TRow | undefined> {
  const first = args[0];
  const conditions: SQL[] = [];
  // Discriminator: drizzle's SQL hat sowohl queryChunks als auch getSQL().
  // Plain WhereObject hat keins von beiden.
  const isSqlAst =
    first !== null &&
    typeof first === "object" &&
    ("queryChunks" in first ||
      typeof (first as { getSQL?: unknown }).getSQL === "function");
  if (!isSqlAst && first !== null && typeof first === "object") {
    // plain object → expand to eq() for each key
    const tableAny = table as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(first as WhereObject)) {
      const col = tableAny[key];
      if (col === undefined) {
        throw new Error(`fetchOne: column "${key}" not on table`);
      }
      conditions.push(eq(col as Parameters<typeof eq>[0], value));
    }
  } else {
    for (const arg of args as readonly SQL[]) conditions.push(arg);
  }
  if (conditions.length === 0) {
    throw new Error("fetchOne: no conditions provided");
  }
  const whereSql = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db.select().from(table).where(whereSql).limit(1);
  return rows[0] as TRow | undefined; // @cast-boundary db-row
}
