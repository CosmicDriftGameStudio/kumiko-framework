import { KUMIKO_NAME_SYMBOL, type SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import {
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbMode,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";
import {
  asEntityTableMeta,
  asRawClient,
  deleteMany as bunDeleteMany,
  fetchOne as bunFetchOne,
  insertOne as bunInsertOne,
  selectMany as bunSelectMany,
  updateMany as bunUpdateMany,
  type SelectOptions,
  type WhereObject,
} from "../db/query";
import { SYSTEM_TENANT_ID, type TenantId } from "../engine/types/identifiers";
import { AccessDeniedError, InternalError } from "../errors";
import { emitDbQuery, type Meter, registerStandardMetrics, type Tracer } from "../observability";
import type { DbRunner } from "./connection";

type Table = SchemaTable;

export {
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbMode,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";

// buildHandlerContext (pipeline/dispatch-shared.ts) always builds "system"
// mode from the caller's own tenantId, never a foreign one.
//
// dbOutsideTransaction is optional so every existing single-arg call site
// (jobs, tests, delivery-service.ts) keeps compiling — those callers have no
// outside-tx source to hand in and never needed one. Only
// buildHandlerContext passes it, which is also the only place `.outsideTransaction`
// is reachable through `ctx.systemDb`.
export function createUncheckedSystemDb(
  db: TenantDb,
  dbOutsideTransaction?: TenantDb,
): UncheckedSystemDb {
  const allowedTenantIds: readonly TenantId[] = [db.tenantId, SYSTEM_TENANT_ID];

  // Fails closed instead of falling back to the in-tx `db` — a silent
  // fallback would defeat the point of a durability write that must survive
  // a rollback of the handler's own transaction. InternalError (not
  // AccessDeniedError) because this is a dispatch wiring fault, not a
  // tenant-access denial — mirrors the "no database connection configured"
  // case in dispatch-shared.ts's appendDomainEvent.
  function requireOutsideTransactionDb(): TenantDb {
    if (!dbOutsideTransaction) {
      throw new InternalError({
        message:
          "systemScope() outsideTransaction check failed: no outside-transaction database " +
          "source is configured for this dispatch.",
      });
    }
    return dbOutsideTransaction;
  }

  return {
    [SYSTEM_SCOPE_CHECK_BRAND]: true,

    assertTenantMatch(tenantId) {
      if (tenantId !== db.tenantId) {
        throw new AccessDeniedError({
          message: `systemScope() tenant self-check failed: expected "${db.tenantId}", got "${tenantId}"`,
        });
      }
      return db;
    },

    // Fails closed on any mismatch rather than silently dropping rows.
    // Reference rows (tenantId === SYSTEM_TENANT_ID) are allowed, mirroring
    // "tenant"-mode readWhere's own [tenantId, SYSTEM_TENANT_ID] allowlist.
    assertRowsTenant<T>(rows: readonly T[], tenantField: keyof T): readonly T[] {
      const hasOffender = rows.some(
        (row) => !allowedTenantIds.includes(row[tenantField] as TenantId),
      );
      if (hasOffender) {
        throw new AccessDeniedError({
          message: `systemScope() row tenant self-check failed on field "${String(tenantField)}"`,
        });
      }
      return rows;
    },

    acknowledgeCrossTenant(reason) {
      if (reason.trim().length === 0) {
        throw new Error("acknowledgeCrossTenant requires a non-empty reason");
      }
      return db;
    },

    outsideTransaction: {
      assertTenantMatch(tenantId) {
        if (tenantId !== db.tenantId) {
          throw new AccessDeniedError({
            message: `systemScope() outsideTransaction tenant self-check failed: expected "${db.tenantId}", got "${tenantId}"`,
          });
        }
        return requireOutsideTransactionDb();
      },

      acknowledgeCrossTenant(reason) {
        if (reason.trim().length === 0) {
          throw new Error("acknowledgeCrossTenant requires a non-empty reason");
        }
        return requireOutsideTransactionDb();
      },
    },
  };
}

// @cast-boundary tenant-db-row
export function castTenantRows<T>(rows: readonly Record<string, unknown>[]): readonly T[] {
  return rows as unknown as readonly T[];
}

function tableNameOf(table: Table): string {
  const sym = table[KUMIKO_NAME_SYMBOL];
  return typeof sym === "string" ? sym : "<unknown>";
}

// Checks the canonical EntityTableMeta (branded EntityTable's KUMIKO_META_SYMBOL
// or a plain deriveEntityTableMeta/defineUnmanagedTable result), not a direct
// `table.tenantId` property read — the latter only exists on branded EntityTables
// and silently returned false (no tenant filter!) for plain EntityTableMeta
// tables like unmanaged direct-write stores, e.g. userSessionTable.
function hasTenantColumn(table: Table): boolean {
  const meta = asEntityTableMeta(table);
  if (meta) return meta.columns.some((c) => c.name === "tenant_id");
  return (table as Record<string, unknown>)["tenantId"] !== undefined;
}

export function createTenantDb(
  db: DbRunner,
  tenantId: TenantId,
  mode: TenantDbMode = "tenant",
  tracer?: Tracer,
  meter?: Meter,
  signal?: AbortSignal,
): TenantDb {
  if (meter) registerStandardMetrics(meter);

  function withDbSpan<T>(
    operation: "select" | "insert" | "update" | "delete",
    table: Table,
    runner: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (!tracer && !meter) return runner();
    const tableName = tableNameOf(table);
    const start = performance.now();
    const emitMetric = () => {
      if (meter) {
        emitDbQuery(meter, { operation, table: tableName }, (performance.now() - start) / 1000);
      }
    };

    if (!tracer) {
      return (async () => {
        try {
          return await runner();
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
          const result = await runner();
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

  // Reads see own-tenant rows + reference data (tenantId === SYSTEM_TENANT_ID).
  // Writes never touch reference rows — those are system-mode only.
  // A caller-supplied `where.tenantId` may only NARROW the enforced scope
  // (e.g. exclude SYSTEM reference rows at the DB instead of post-filtering
  // after a limit). Values outside the scope are dropped; if nothing valid
  // remains, the full enforced scope applies — widening is never possible.
  function readWhere(table: Table, where?: WhereObject): WhereObject | undefined {
    if (!hasTenantColumn(table) || mode === "system") return where;
    const allowed = [tenantId, SYSTEM_TENANT_ID];
    const requested = where?.["tenantId"];
    if (requested !== undefined) {
      const requestedList = Array.isArray(requested) ? requested : [requested];
      const narrowed = requestedList.filter(
        (t): t is string => typeof t === "string" && allowed.includes(t),
      );
      return { ...where, tenantId: narrowed.length > 0 ? narrowed : allowed };
    }
    const tenantFilter: WhereObject = { tenantId: allowed };
    return where ? { ...where, ...tenantFilter } : tenantFilter;
  }

  function writeWhere(table: Table, where: WhereObject): WhereObject {
    if (!hasTenantColumn(table) || mode === "system") return where;
    return { ...where, tenantId };
  }

  function insertValues(table: Table, data: Record<string, unknown>): Record<string, unknown> {
    if (!hasTenantColumn(table)) return data;
    if (mode === "system") return { tenantId, ...data };
    return { ...data, tenantId };
  }

  return {
    tenantId,
    mode,
    raw: db,

    selectMany<T = Record<string, unknown>>(
      table: Table,
      where?: WhereObject,
      options?: SelectOptions,
    ): Promise<readonly T[]> {
      const filter = readWhere(table, where);
      return withDbSpan("select", table, async () => bunSelectMany<T>(db, table, filter, options));
    },

    fetchOne<T = Record<string, unknown>>(
      table: Table,
      where: WhereObject,
    ): Promise<T | undefined> {
      const filter = readWhere(table, where) ?? {};
      return withDbSpan("select", table, async () => bunFetchOne<T>(db, table, filter));
    },

    insertOne<T = Record<string, unknown>>(
      table: Table,
      values: Record<string, unknown>,
    ): Promise<T | undefined> {
      const data = insertValues(table, values);
      return withDbSpan("insert", table, async () => bunInsertOne<T>(db, table, data));
    },

    updateMany<T = Record<string, unknown>>(
      table: Table,
      set: Record<string, unknown>,
      where: WhereObject,
    ): Promise<readonly T[]> {
      if (!where || Object.keys(where).length === 0) {
        return Promise.reject(
          new Error(
            "TenantDb.updateMany without where would mass-update all tenant rows. Pass at least one where condition.",
          ),
        );
      }
      const filter = writeWhere(table, where);
      return withDbSpan("update", table, async () => bunUpdateMany<T>(db, table, set, filter));
    },

    deleteMany(table: Table, where: WhereObject): Promise<void> {
      if (!where || Object.keys(where).length === 0) {
        return Promise.reject(
          new Error(
            "TenantDb.deleteMany without where would mass-delete all tenant rows. Pass at least one where condition.",
          ),
        );
      }
      const filter = writeWhere(table, where);
      return withDbSpan("delete", table, async () => bunDeleteMany(db, table, filter));
    },
  };
}

export { asRawClient };
