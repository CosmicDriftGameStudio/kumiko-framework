import { and, type Column, eq, or, type SQL } from "drizzle-orm";
import type { DbRunner } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

// biome-ignore lint/suspicious/noExplicitAny: Drizzle column selection
type ColumnSelection = Record<string, any>;

/**
 * TenantDb scope modes:
 *
 * - "tenant" (default): SELECT/UPDATE/DELETE filtered by tenantId + reference data (tenantId=0).
 *   INSERT forces tenantId — handler cannot override.
 *
 * - "system" (r.systemScope()): No tenant filter on reads/updates/deletes.
 *   INSERT uses tenantId as default but handler can override (e.g. tenantId: null for system config).
 *
 * Tables without a tenantId column are always unfiltered regardless of mode.
 */
export type TenantDbMode = "tenant" | "system";

export type TenantDb = {
  readonly tenantId: number;
  readonly mode: TenantDbMode;
  select(): TenantSelect;
  select(columns: ColumnSelection): TenantSelect;
  insert(table: Table): TenantInsert;
  update(table: Table): TenantUpdate;
  delete(table: Table): TenantDelete;
};

type TenantSelect = {
  from(table: Table): TenantSelectQuery;
};

type WhereCondition = SQL | undefined;

type TenantSelectQuery = PromiseLike<Record<string, unknown>[]> & {
  where(condition: WhereCondition): TenantSelectQuery;
  limit(n: number): TenantSelectQuery;
  orderBy(...columns: (SQL | Column)[]): TenantSelectQuery;
};

type TenantInsert = {
  values(data: Record<string, unknown>): TenantInsertValues;
};

type TenantInsertValues = PromiseLike<void> & {
  returning(): PromiseLike<Record<string, unknown>[]>;
};

type TenantUpdate = {
  set(data: Record<string, unknown>): TenantUpdateSet;
};

type TenantUpdateSet = PromiseLike<void> & {
  where(condition: WhereCondition): TenantUpdateWhere;
  returning(): PromiseLike<Record<string, unknown>[]>;
};

type TenantUpdateWhere = PromiseLike<void> & {
  returning(): PromiseLike<Record<string, unknown>[]>;
};

type TenantDelete = {
  where(condition: WhereCondition): PromiseLike<void>;
};

export function createTenantDb(
  db: DbRunner,
  tenantId: number,
  mode: TenantDbMode = "tenant",
): TenantDb {
  function hasTenantColumn(table: Table): boolean {
    return table["tenantId"] !== undefined;
  }

  // --- Read filter (SELECT/UPDATE/DELETE WHERE clause) ---

  function readFilter(table: Table, ...extra: SQL[]): SQL | undefined {
    if (!hasTenantColumn(table)) {
      return extra.length > 0 ? and(...extra) : undefined;
    }

    if (mode === "system") {
      // System mode: no tenant restriction, only pass through extra conditions
      return extra.length > 0 ? and(...extra) : undefined;
    }

    // Tenant mode: own data + reference data (tenantId = 0)
    const ownOrGlobal = or(eq(table["tenantId"], tenantId), eq(table["tenantId"], 0)) as SQL;
    return extra.length > 0 ? and(ownOrGlobal, ...extra) : ownOrGlobal;
  }

  // --- Write values (INSERT tenantId handling) ---

  function insertValues(table: Table, data: Record<string, unknown>): Record<string, unknown> {
    if (!hasTenantColumn(table)) return data;

    if (mode === "system") {
      // System mode: tenantId is a default, handler can override (e.g. null for system config)
      return { tenantId, ...data };
    }

    // Tenant mode: tenantId is forced, handler cannot override
    return { ...data, tenantId };
  }

  // --- Select wrapper (lazy filter + chainable) ---

  function wrapSelect(
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle internal query type
    query: any,
    table: Table,
    filtered: boolean,
  ): TenantSelectQuery {
    function ensureFiltered() {
      if (filtered) return query;
      const filter = readFilter(table);
      return filter ? query.where(filter) : query;
    }

    return {
      where(condition: SQL) {
        const filter = readFilter(table, condition);
        return wrapSelect(filter ? query.where(filter) : query.where(condition), table, true);
      },
      limit(n: number) {
        return wrapSelect(ensureFiltered().limit(n), table, true);
      },
      orderBy(...columns: SQL[]) {
        return wrapSelect(ensureFiltered().orderBy(...columns), table, true);
      },
      // biome-ignore lint/suspicious/noThenProperty: thenable for await
      then(
        resolve: ((value: Record<string, unknown>[]) => void) | null,
        reject: ((reason: unknown) => void) | null,
      ) {
        return ensureFiltered().then(
          (rows: Record<string, unknown>[]) => resolve?.(rows),
          reject ?? undefined,
        );
      },
    } as TenantSelectQuery;
  }

  // --- Where helper for update/delete ---

  function whereClause(table: Table, condition: SQL): SQL {
    const filter = readFilter(table, condition);
    return filter ?? condition;
  }

  function whereAll(table: Table): SQL | undefined {
    return readFilter(table);
  }

  return {
    tenantId,
    mode,

    select(columns?: ColumnSelection) {
      return {
        from(table: Table) {
          const baseQuery = columns ? db.select(columns).from(table) : db.select().from(table);
          return wrapSelect(baseQuery, table, false);
        },
      };
    },

    insert(table: Table) {
      return {
        values(data: Record<string, unknown>) {
          const q = db.insert(table).values(insertValues(table, data));
          return {
            returning() {
              return q.returning() as PromiseLike<Record<string, unknown>[]>;
            },
            // biome-ignore lint/suspicious/noThenProperty: thenable for await
            then(resolve, reject) {
              return (q as unknown as PromiseLike<void>).then(resolve, reject);
            },
          } as TenantInsertValues;
        },
      };
    },

    update(table: Table) {
      return {
        set(data: Record<string, unknown>) {
          const q = db.update(table).set(data);
          return {
            where(condition: SQL) {
              const wq = q.where(whereClause(table, condition));
              return {
                returning() {
                  return wq.returning() as PromiseLike<Record<string, unknown>[]>;
                },
                // biome-ignore lint/suspicious/noThenProperty: thenable for await
                then(resolve, reject) {
                  return (wq as unknown as PromiseLike<void>).then(resolve, reject);
                },
              } as TenantUpdateWhere;
            },
            returning() {
              const filter = whereAll(table);
              const wq = filter ? q.where(filter) : q;
              return wq.returning() as PromiseLike<Record<string, unknown>[]>;
            },
            // biome-ignore lint/suspicious/noThenProperty: thenable for await
            then(resolve, reject) {
              const filter = whereAll(table);
              const wq = filter ? q.where(filter) : q;
              return (wq as unknown as PromiseLike<void>).then(resolve, reject);
            },
          } as TenantUpdateSet;
        },
      };
    },

    delete(table: Table) {
      return {
        where(condition: SQL) {
          return db
            .delete(table)
            .where(whereClause(table, condition)) as unknown as PromiseLike<void>;
        },
      };
    },
  };
}
