import { and, eq, type SQL } from "drizzle-orm";
import type { DbConnection } from "./connection";
import type { TableColumns } from "./dialect";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables
type Table = TableColumns<any>;

// biome-ignore lint/suspicious/noExplicitAny: Drizzle column selection
type ColumnSelection = Record<string, any>;

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

export function createTenantDb(db: DbConnection, tenantId: number): TenantDb {
  function tenantFilter(table: Table, ...extra: SQL[]): SQL {
    const conditions = [eq(table["tenantId"], tenantId), ...extra];
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
      return applied ? query : query.where(tenantFilter(table));
    }

    return {
      where(condition: SQL) {
        return wrapSelect(query.where(tenantFilter(table, condition)), table, true);
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
          const q = db.insert(table).values({ ...data, tenantId });
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
              const wq = q.where(tenantFilter(table, condition));
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
              return q.where(tenantFilter(table)).returning() as PromiseLike<
                Record<string, unknown>[]
              >;
            },
            then(resolve, reject) {
              return (q.where(tenantFilter(table)) as unknown as PromiseLike<void>).then(
                resolve,
                reject,
              );
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
            .where(tenantFilter(table, condition)) as unknown as PromiseLike<void>;
        },
      };
    },
  };
}
