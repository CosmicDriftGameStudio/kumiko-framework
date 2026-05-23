// Typed Query-API ohne direkten drizzle-orm-Import im Caller. Wrapped
// drizzle intern — App-Author + bundled-features sehen nur diese Helpers.
// drizzle bleibt als Backend bis Phase 4 (Bun.sql) sauber ist.
//
// Pattern: alle Funktionen nehmen `where?: WhereObject` (plain object,
// keys = field-names, values = expected). Kombiniert intern mit AND/eq.
//
// Für komplexere Queries (raw SQL, OR, partial-where) bleibt drizzle's
// API (sql, or, etc.) verfügbar — diese helpers decken die ~80% trivial
// cases ab.

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  getTableName,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  max,
  min,
  ne,
  or,
  type SQL,
  sql,
  type Table,
} from "drizzle-orm";
import type { AnyPgColumn as AnyColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbRow } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: drizzle's PgTable is variadic-typed; we accept any table to stay narrow at call-sites.
type AnyTable = TableColumns<any>;

type SelectChain = {
  select: () => {
    from: (table: AnyTable) => {
      where: (cond: SQL | undefined) => SelectChainTail;
    };
  };
  insert: (table: AnyTable) => {
    values: (v: Record<string, unknown>) => { returning: () => PromiseLike<readonly Record<string, unknown>[]> };
  };
  update: (table: AnyTable) => {
    set: (v: Record<string, unknown>) => {
      where: (cond: SQL | undefined) => {
        returning: () => PromiseLike<readonly Record<string, unknown>[]>;
      };
    };
  };
  delete: (table: AnyTable) => {
    where: (cond: SQL | undefined) => PromiseLike<unknown>;
  };
};

type SelectChainTail = {
  limit: (n: number) => PromiseLike<readonly Record<string, unknown>[]>;
  orderBy: (...args: SQL[]) => {
    limit: (n: number) => PromiseLike<readonly Record<string, unknown>[]>;
  };
} & PromiseLike<readonly Record<string, unknown>[]>;

export type WhereValue = unknown;
export type WhereObject = Record<string, WhereValue>;

// Erweitert ein WhereObject auf eine drizzle-SQL-condition. Werte sind:
//   - primitives (string/number/boolean/null) → `eq(col, v)` oder `isNull(col)`
//   - arrays → `inArray(col, [...])`
// Caller can mix with raw `sql\`...\`` for edge-cases by passing SQL[]
// instead of WhereObject (selectMany/updateOne/deleteMany overloads).
function objectToCondition(table: AnyTable, where: WhereObject): SQL | undefined {
  const tableAny = table as unknown as Record<string, unknown>;
  const conds: SQL[] = [];
  for (const [key, value] of Object.entries(where)) {
    const col = tableAny[key];
    if (col === undefined) {
      throw new Error(`query-api: column "${key}" not on table`);
    }
    if (value === null) {
      conds.push(isNull(col as Parameters<typeof isNull>[0]));
    } else if (Array.isArray(value)) {
      conds.push(inArray(col as Parameters<typeof inArray>[0], value));
    } else {
      conds.push(eq(col as Parameters<typeof eq>[0], value));
    }
  }
  if (conds.length === 0) return undefined;
  if (conds.length === 1) return conds[0];
  return and(...conds);
}

export type SelectOptions = {
  readonly limit?: number;
  readonly orderBy?: { readonly col: string; readonly direction?: "asc" | "desc" };
};

export async function selectMany<TRow = DbRow>(
  db: SelectChain,
  table: AnyTable,
  where?: WhereObject,
  options?: SelectOptions,
): Promise<readonly TRow[]> {
  const cond = where !== undefined ? objectToCondition(table, where) : undefined;
  const chain = db.select().from(table).where(cond);
  if (options?.orderBy) {
    const tableAny = table as unknown as Record<string, unknown>;
    const col = tableAny[options.orderBy.col];
    if (col === undefined) {
      throw new Error(`query-api: orderBy column "${options.orderBy.col}" not on table`);
    }
    const orderFn = options.orderBy.direction === "desc" ? desc : asc;
    const ordered = chain.orderBy(orderFn(col as Parameters<typeof asc>[0]));
    if (options.limit !== undefined) {
      return (await ordered.limit(options.limit)) as readonly TRow[];
    }
    return (await ordered.limit(Number.MAX_SAFE_INTEGER)) as readonly TRow[];
  }
  if (options?.limit !== undefined) {
    return (await chain.limit(options.limit)) as readonly TRow[];
  }
  return (await chain) as readonly TRow[];
}

export async function insertOne<TRow = DbRow>(
  db: SelectChain,
  table: AnyTable,
  values: Record<string, unknown>,
): Promise<TRow | undefined> {
  const rows = await db.insert(table).values(values).returning();
  return rows[0] as TRow | undefined;
}

export async function updateMany<TRow = DbRow>(
  db: SelectChain,
  table: AnyTable,
  set: Record<string, unknown>,
  where: WhereObject,
): Promise<readonly TRow[]> {
  const cond = objectToCondition(table, where);
  const rows = await db.update(table).set(set).where(cond).returning();
  return rows as readonly TRow[];
}

export async function deleteMany(
  db: SelectChain,
  table: AnyTable,
  where: WhereObject,
): Promise<void> {
  const cond = objectToCondition(table, where);
  await db.delete(table).where(cond);
}

// Re-exports der drizzle-Operators + sql template + reflection-API.
// App-code importiert NUR über @cosmicdrift/kumiko-framework/db —
// drizzle-orm wird damit zur reinen framework-internen Dependency.
// Phase 4 (Bun.sql) wechselt die interne Implementation ohne App-code
// zu touchen.
export {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  getTableName,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  max,
  min,
  ne,
  or,
  sql,
};
export type { AnyColumn, PgTable, SQL, Table };
