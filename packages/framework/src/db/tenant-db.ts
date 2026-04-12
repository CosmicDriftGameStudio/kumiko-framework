import { and, eq, or, type SQL } from "drizzle-orm";
import type { DbConnection } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

// biome-ignore lint/suspicious/noExplicitAny: Drizzle column selection
type ColumnSelection = Record<string, any>;

export type TenantDbOptions = {
  readonly unscoped?: boolean;
};

export type TenantDb = {
  readonly tenantId: number;
  select(): TenantSelect;
  select(columns: ColumnSelection): TenantSelect;
  insert(table: Table): TenantInsert;
  update(table: Table): TenantUpdate;
  delete(table: Table): TenantDelete;
};

type TenantSelect = {
  from(table: Table): TenantSelectQuery;
};

type TenantSelectQuery = PromiseLike<Record<string, unknown>[]> & {
  where(condition: SQL): TenantSelectQuery;
  limit(n: number): TenantSelectQuery;
  orderBy(...columns: SQL[]): TenantSelectQuery;
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
  where(condition: SQL): TenantUpdateWhere;
  returning(): PromiseLike<Record<string, unknown>[]>;
};

type TenantUpdateWhere = PromiseLike<void> & {
  returning(): PromiseLike<Record<string, unknown>[]>;
};

type TenantDelete = {
  where(condition: SQL): PromiseLike<void>;
};

export function createTenantDb(
  db: DbConnection,
  tenantId: number,
  options?: TenantDbOptions,
): TenantDb {
  const unscoped = options?.unscoped ?? false;

  function hasTenantColumn(table: Table): boolean {
    return table["tenantId"] !== undefined;
  }

  function tenantFilter(table: Table, ...extra: SQL[]): SQL | undefined {
    // Unscoped mode: no tenant filter on reads/updates/deletes (system-scoped features)
    // Also skip if table doesn't have a tenantId column
    if (unscoped || !hasTenantColumn(table)) {
      return extra.length > 0 ? and(...extra) : undefined;
    }
    // Include own tenant + global data (tenantId = 0 = system/reference data)
    const tenantCondition = or(eq(table["tenantId"], tenantId), eq(table["tenantId"], 0))!;
    const conditions = [tenantCondition, ...extra];
    return and(...conditions)!;
  }

  // Wraps a Drizzle query into a chainable thenable with tenant filter
  function wrapSelect(
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle internal query type
    query: any,
    table: Table,
    applied: boolean,
  ): TenantSelectQuery {
    // Lazily apply tenant filter when awaited (if not yet applied via .where())
    function getFiltered() {
      if (applied) return query;
      const filter = tenantFilter(table);
      return filter ? query.where(filter) : query;
    }

    return {
      where(condition: SQL) {
        const filter = tenantFilter(table, condition);
        return wrapSelect(filter ? query.where(filter) : query.where(condition), table, true);
      },
      limit(n: number) {
        return wrapSelect(getFiltered().limit(n), table, true);
      },
      orderBy(...columns: SQL[]) {
        return wrapSelect(getFiltered().orderBy(...columns), table, true);
      },
      then(resolve, reject) {
        return getFiltered().then((rows: Record<string, unknown>[]) => resolve(rows), reject);
      },
    } as TenantSelectQuery;
  }

  return {
    tenantId,

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
          // Scoped: TenantDb's tenantId wins (security — can't override)
          // Unscoped: handler's value wins (system features set tenantId explicitly or null)
          const values = !hasTenantColumn(table)
            ? data
            : unscoped
              ? { tenantId, ...data }
              : { ...data, tenantId };
          const q = db.insert(table).values(values);
          return {
            returning() {
              return q.returning() as PromiseLike<Record<string, unknown>[]>;
            },
            then(resolve, reject) {
              return (q as PromiseLike<void>).then(resolve, reject);
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
              const filter = tenantFilter(table, condition);
              const wq = q.where(filter ?? condition);
              return {
                returning() {
                  return wq.returning() as PromiseLike<Record<string, unknown>[]>;
                },
                then(resolve, reject) {
                  return (wq as unknown as PromiseLike<void>).then(resolve, reject);
                },
              } as TenantUpdateWhere;
            },
            returning() {
              const filter = tenantFilter(table);
              const wq = filter ? q.where(filter) : q;
              return wq.returning() as PromiseLike<Record<string, unknown>[]>;
            },
            then(resolve, reject) {
              const filter = tenantFilter(table);
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
          const filter = tenantFilter(table, condition);
          return db
            .delete(table)
            .where(filter ?? condition) as unknown as PromiseLike<void>;
        },
      };
    },
  };
}
