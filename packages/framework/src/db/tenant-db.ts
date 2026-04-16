import type { TenantId } from "@kumiko/framework/engine";
import { and, type Column, eq, getTableName, or, type SQL } from "drizzle-orm";
import { emitDbQuery, type Meter, registerStandardMetrics, type Tracer } from "../observability";
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
  readonly tenantId: TenantId;
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

type RowLockStrength = "update" | "no key update" | "share" | "key share";

type TenantSelectQuery = PromiseLike<Record<string, unknown>[]> & {
  where(condition: WhereCondition): TenantSelectQuery;
  limit(n: number): TenantSelectQuery;
  orderBy(...columns: (SQL | Column)[]): TenantSelectQuery;
  /** Row-level locking (FOR UPDATE / FOR SHARE). Must be called inside a tx. */
  for(strength: RowLockStrength): TenantSelectQuery;
};

type TenantInsert = {
  values(data: Record<string, unknown>): TenantInsertValues;
};

type ConflictTarget = Column | readonly Column[];
type ConflictUpdate = {
  target: ConflictTarget;
  set: Record<string, unknown>;
};

type TenantInsertValues = PromiseLike<void> & {
  returning(): PromiseLike<Record<string, unknown>[]>;
  onConflictDoUpdate(spec: ConflictUpdate): PromiseLike<void>;
  onConflictDoNothing(spec?: { target: ConflictTarget }): PromiseLike<void>;
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
  tenantId: TenantId,
  mode: TenantDbMode = "tenant",
  tracer?: Tracer,
  meter?: Meter,
): TenantDb {
  // If a meter was passed, make sure standard metrics are registered on it
  // before we try to emit. Idempotent — buildServer typically registers them
  // up front; this guards against test call-sites that wire up a TenantDb
  // directly with a fresh meter.
  if (meter) registerStandardMetrics(meter);

  function hasTenantColumn(table: Table): boolean {
    return table["tenantId"] !== undefined;
  }

  // Wrap a DB query promise in a `db.query` span + emit the DB duration
  // histogram. Row count is recorded when the result is an array (SELECTs
  // + *.returning()). Metric is emitted both on success and on throw so
  // slow failing queries show up too.
  function withDbSpan<T>(
    operation: "select" | "insert" | "update" | "delete",
    table: Table,
    exec: () => PromiseLike<T>,
  ): PromiseLike<T> {
    if (!tracer && !meter) return exec();
    const tableName = getTableName(table);
    const start = performance.now();
    const emitMetric = () => {
      if (meter) {
        emitDbQuery(meter, { operation, table: tableName }, (performance.now() - start) / 1000);
      }
    };

    if (!tracer) {
      // Tracer absent but meter present: just time + emit, no span.
      return (async () => {
        try {
          return await exec();
        } finally {
          emitMetric();
        }
      })();
    }

    return tracer.withSpan(
      "db.query",
      {
        kind: "client",
        attributes: {
          "db.system": "postgresql",
          "db.operation": operation,
          "db.table": tableName,
        },
      },
      async (span) => {
        try {
          const result = await exec();
          if (Array.isArray(result)) {
            span.setAttribute("db.row_count", result.length);
          }
          return result;
        } finally {
          emitMetric();
        }
      },
    );
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

    // Tenant mode: own data + reference data (zero-UUID tenantId for global rows)
    const ownOrGlobal = or(
      eq(table["tenantId"], tenantId),
      eq(table["tenantId"], "00000000-0000-4000-8000-000000000000"),
    ) as SQL;
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
      for(strength: RowLockStrength) {
        return wrapSelect(ensureFiltered().for(strength), table, true);
      },
      // biome-ignore lint/suspicious/noThenProperty: thenable for await
      then(
        resolve: ((value: Record<string, unknown>[]) => void) | null,
        reject: ((reason: unknown) => void) | null,
      ) {
        return withDbSpan<Record<string, unknown>[]>("select", table, () => ensureFiltered()).then(
          (rows) => resolve?.(rows),
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
              return withDbSpan<Record<string, unknown>[]>(
                "insert",
                table,
                () => q.returning() as PromiseLike<Record<string, unknown>[]>,
              );
            },
            onConflictDoUpdate(spec: ConflictUpdate) {
              return withDbSpan<void>("insert", table, () =>
                (
                  q as unknown as {
                    onConflictDoUpdate: (s: ConflictUpdate) => PromiseLike<void>;
                  }
                ).onConflictDoUpdate(spec),
              );
            },
            onConflictDoNothing(spec?: { target: ConflictTarget }) {
              return withDbSpan<void>("insert", table, () =>
                (
                  q as unknown as {
                    onConflictDoNothing: (s?: { target: ConflictTarget }) => PromiseLike<void>;
                  }
                ).onConflictDoNothing(spec),
              );
            },
            // biome-ignore lint/suspicious/noThenProperty: thenable for await
            then(resolve, reject) {
              return withDbSpan<void>(
                "insert",
                table,
                () => q as unknown as PromiseLike<void>,
              ).then(resolve, reject);
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
                  return withDbSpan<Record<string, unknown>[]>(
                    "update",
                    table,
                    () => wq.returning() as PromiseLike<Record<string, unknown>[]>,
                  );
                },
                // biome-ignore lint/suspicious/noThenProperty: thenable for await
                then(resolve, reject) {
                  return withDbSpan<void>(
                    "update",
                    table,
                    () => wq as unknown as PromiseLike<void>,
                  ).then(resolve, reject);
                },
              } as TenantUpdateWhere;
            },
            returning(): PromiseLike<Record<string, unknown>[]> {
              return Promise.reject(
                new Error(
                  "TenantDb.update().set().returning() without .where() would mass-update all tenant rows. " +
                    "Add .where(...) first, or call .set(...).where(...).returning().",
                ),
              );
            },
            // biome-ignore lint/suspicious/noThenProperty: thenable for await
            then(resolve, reject) {
              return Promise.reject(
                new Error(
                  "TenantDb.update().set() awaited without .where() would mass-update all tenant rows. " +
                    "Add .where(...) before awaiting.",
                ),
              ).then(resolve, reject);
            },
          } as TenantUpdateSet;
        },
      };
    },

    delete(table: Table) {
      return {
        where(condition: SQL) {
          return withDbSpan<void>(
            "delete",
            table,
            () =>
              db.delete(table).where(whereClause(table, condition)) as unknown as PromiseLike<void>,
          );
        },
      };
    },
  };
}
