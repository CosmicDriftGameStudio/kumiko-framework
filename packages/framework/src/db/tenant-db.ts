import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
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
 *   INSERT uses tenantId as default but handler can override (e.g. write a
 *   cross-tenant row to a shared sentinel like SYSTEM_TENANT_ID).
 *
 * Tables without a tenantId column are always unfiltered regardless of mode.
 */
export type TenantDbMode = "tenant" | "system";

export type TenantDb = {
  readonly tenantId: TenantId;
  readonly mode: TenantDbMode;
  /**
   * Underlying DbRunner. Framework-internal use (event-store, migrations) —
   * bypasses tenant-filter. Feature code should stick to the typed wrappers
   * above so the automatic scoping stays intact.
   */
  readonly raw: DbRunner;
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
  offset(n: number): TenantSelectQuery;
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

/**
 * Cast helper for the `Record<string, unknown>[]` rows that
 * `TenantDb.select()` returns.
 *
 * Usage:
 *   const rows = castTenantRows<MyRow>(
 *     await ctx.db.select({...}).from(myTable),
 *   );
 *
 * Why this exists: drizzle's `.select({col1: t.col1, ...})` natively
 * returns `Array<{col1: T1, ...}>`, but our TenantDb wrapper erases
 * that shape to `Record<string, unknown>[]` so it can centralize tenant-
 * scoping. Until the wrapper preserves the typed-row shape (see memory:
 * project_tenant_db_typed_rows), call sites need to assert the column
 * shape they just selected. This helper:
 *   - centralises the cast (single grep target for the future refactor)
 *   - tags it with `@cast-boundary tenant-db-row` for the as-cast audit
 *   - documents the trade-off once instead of N times
 *
 * Removal plan: when TenantSelectQuery becomes generic over the
 * column-shape, every `castTenantRows<T>(...)` call is just `await ...`
 * and this helper goes away.
 */
// @cast-boundary tenant-db-row
export function castTenantRows<T>(rows: readonly Record<string, unknown>[]): readonly T[] {
  return rows as unknown as readonly T[];
}

export function createTenantDb(
  db: DbRunner,
  tenantId: TenantId,
  mode: TenantDbMode = "tenant",
  tracer?: Tracer,
  meter?: Meter,
  // Pre-flight cancellation: when set, every query check
  // `signal.throwIfAborted()` BEFORE issuing the SQL. The currently
  // running query is not actively cancelled (postgres-js connection
  // cancel is a separate, riskier feature). This still saves the bulk
  // of the wasted work in handlers that fire many sequential queries
  // — once the client disconnects, the next query throws and the rest
  // of the chain falls away.
  signal?: AbortSignal,
): TenantDb {
  // If a meter was passed, make sure standard metrics are registered on it
  // before we try to emit. Idempotent — buildServer typically registers them
  // up front; this guards against test call-sites that wire up a TenantDb
  // directly with a fresh meter.
  if (meter) registerStandardMetrics(meter);

  function hasTenantColumn(table: Table): boolean {
    return table["tenantId"] !== undefined;
  }

  // Drizzle's terminal builders (insert, update().where, delete().where) are
  // thenable — `.then` is there so `await` works — but the declared return
  // types don't include PromiseLike. Cast via this helper so the double-
  // cast is named and lives in exactly one place per scope.
  function asDrizzleThenable<T>(builder: unknown): PromiseLike<T> {
    return builder as PromiseLike<T>;
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
    // Pre-flight cancellation. Sits above the early-return so the check
    // fires regardless of observability config — cancellation is a
    // correctness feature, not an observability one.
    signal?.throwIfAborted();
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

  // --- Read filter (SELECT WHERE clause) ---
  //
  // Reads in tenant mode see their own rows AND global reference data (rows
  // with tenantId = SYSTEM_TENANT_ID). Writes explicitly do NOT — see writeFilter.

  function readFilter(table: Table, ...extra: SQL[]): SQL | undefined {
    if (!hasTenantColumn(table)) {
      return extra.length > 0 ? and(...extra) : undefined;
    }

    if (mode === "system") {
      // System mode: no tenant restriction, only pass through extra conditions
      return extra.length > 0 ? and(...extra) : undefined;
    }

    // Tenant mode: own data + reference data (zero-UUID tenantId for global rows).
    // Drizzle's `or()` is typed `SQL | undefined` (variadic-empty case); both
    // `eq()` args always produce SQL, so the cast documents that assumption.
    const ownOrGlobal = or(
      eq(table["tenantId"], tenantId),
      eq(table["tenantId"], SYSTEM_TENANT_ID),
    ) as SQL;
    return extra.length > 0 ? and(ownOrGlobal, ...extra) : ownOrGlobal;
  }

  // --- Write filter (UPDATE/DELETE WHERE clause) ---
  //
  // Writes in tenant mode must NEVER match reference rows — otherwise a tenant
  // could mutate global data by coincidence of id/condition. Only system-scope
  // (r.systemScope()) may modify reference data.

  function writeFilter(table: Table, ...extra: SQL[]): SQL | undefined {
    if (!hasTenantColumn(table)) {
      return extra.length > 0 ? and(...extra) : undefined;
    }

    if (mode === "system") {
      return extra.length > 0 ? and(...extra) : undefined;
    }

    const ownOnly = eq(table["tenantId"], tenantId);
    return extra.length > 0 ? and(ownOnly, ...extra) : ownOnly;
  }

  // --- Write values (INSERT tenantId handling) ---

  function insertValues(table: Table, data: Record<string, unknown>): Record<string, unknown> {
    if (!hasTenantColumn(table)) return data;

    if (mode === "system") {
      // System mode: tenantId is a default the handler can override —
      // e.g. to write a cross-tenant row under SYSTEM_TENANT_ID, or to
      // target a foreign tenant's projection from a SystemAdmin action.
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
      offset(n: number) {
        return wrapSelect(ensureFiltered().offset(n), table, true);
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
    const filter = writeFilter(table, condition);
    return filter ?? condition;
  }

  return {
    tenantId,
    mode,
    raw: db,

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
              return withDbSpan<void>("insert", table, () => asDrizzleThenable<void>(q)).then(
                resolve,
                reject,
              );
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
                  return withDbSpan<void>("update", table, () => asDrizzleThenable<void>(wq)).then(
                    resolve,
                    reject,
                  );
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
          return withDbSpan<void>("delete", table, () =>
            asDrizzleThenable<void>(db.delete(table).where(whereClause(table, condition))),
          );
        },
      };
    },
  };
}
