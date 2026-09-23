import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type {
  EscapeHatchDeclaration,
  EscapeHatchReporter,
} from "@cosmicdrift/kumiko-types/handlers";
import { KUMIKO_NAME_SYMBOL, type SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";
import {
  type GlobalTableDb,
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbMode,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";
import {
  asEntityTableMeta,
  asRawClient,
  countWhere as bunCountWhere,
  deleteMany as bunDeleteMany,
  fetchOne as bunFetchOne,
  insertOne as bunInsertOne,
  selectMany as bunSelectMany,
  updateMany as bunUpdateMany,
  type SelectOptions,
  type WhereObject,
} from "../db/query";
import type { EntityDefinition } from "../engine/types/fields";
import { SYSTEM_TENANT_ID, type TenantId } from "../engine/types/identifiers";
import { AccessDeniedError, InternalError, memberResolutionReadOnlyDenied } from "../errors";
import { emitDbQuery, type Meter, registerStandardMetrics, type Tracer } from "../observability";
import { fallbackEscapeHatchReporter } from "../observability/escape-hatch-report";
import type { DbRunner } from "./connection";
import { bindTenantDbRunner, tenantDbRunner } from "./tenant-db-runner";

type Table = SchemaTable;

export {
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbMode,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";

const declaredUnsafeRawRunners = new WeakMap<
  TenantDb | UncheckedSystemDb,
  (reason: string) => DbRunner
>();

// The CRUD executor writes through tenantDbRunner, not insertOne, so it asks the
// TenantDb it was handed for its gate. Bound inside createTenantDb so rebound instances
// (withUnsafeRawGrant, acknowledgeConventionCrossTenant) carry it too.
const personalDataGates = new WeakMap<TenantDb, PersonalDataGate>();

// The executor passes its entity so the check does not depend on the table-name lookup.
export function assertPersonalDataWrite(
  db: TenantDb,
  tableName: string,
  keys: readonly string[],
  entity: EntityDefinition,
): void {
  personalDataGates.get(db)?.(tableName, keys, entity);
}

// Framework-private (not re-exported from db/index.ts): same grant check + audit as unsafeRaw, for engine forwarding.
export function unsafeRawForDeclaredStep(
  holder: TenantDb | UncheckedSystemDb,
  reason: string,
): DbRunner {
  if (reason.trim().length === 0) {
    throw new Error("unsafeRawForDeclaredStep requires a non-empty reason");
  }
  const runner = declaredUnsafeRawRunners.get(holder);
  if (!runner) {
    throw new InternalError({
      message:
        "unsafeRawForDeclaredStep received a holder not built by createTenantDb or " +
        "createUncheckedSystemDb — no declared unsafeRaw runner bound.",
    });
  }
  return runner(reason);
}

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
  report: EscapeHatchReporter = fallbackEscapeHatchReporter(db.tenantId),
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

  function grantedUnsafeRawRunner(reason: string): DbRunner {
    if (reason.trim().length === 0) {
      throw new Error("unsafeRaw requires a non-empty reason");
    }
    report("unsafe-raw", reason);
    return tenantDbRunner(db);
  }

  const uncheckedSystemDb: UncheckedSystemDb = {
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
      report("acknowledge-cross-tenant", reason);
      return db;
    },

    unsafeRaw: grantedUnsafeRawRunner,

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
        const result = requireOutsideTransactionDb();
        report("acknowledge-cross-tenant", reason);
        return result;
      },
    },
  };
  declaredUnsafeRawRunners.set(uncheckedSystemDb, grantedUnsafeRawRunner);
  return uncheckedSystemDb;
}

// @cast-boundary tenant-db-row
export function castTenantRows<T>(rows: readonly Record<string, unknown>[]): readonly T[] {
  return rows as unknown as readonly T[];
}

export function tableNameOf(table: Table | EntityTableMeta): string {
  const sym = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
  if (typeof sym === "string") return sym;
  return asEntityTableMeta(table)?.tableName ?? "<unknown>";
}

// A grant is only real when its reason is non-empty — `{ reason: "" }` must not silently unlock it.
function hasGrant(decl: EscapeHatchDeclaration | undefined): boolean {
  return decl !== undefined && decl.reason.trim().length > 0;
}

function isForeignTenantId(tenantIdValue: unknown): boolean {
  return tenantIdValue !== undefined && tenantIdValue !== SYSTEM_TENANT_ID;
}

// Checks the canonical EntityTableMeta (branded EntityTable's KUMIKO_META_SYMBOL
// or a plain deriveEntityTableMeta/defineUnmanagedTable result), not a direct
// `table.tenantId` property read — the latter only exists on branded EntityTables
// and silently returned false (no tenant filter!) for plain EntityTableMeta
// tables like unmanaged direct-write stores, e.g. userSessionTable.
export function hasTenantColumn(table: Table | EntityTableMeta): boolean {
  const meta = asEntityTableMeta(table);
  if (meta) return meta.columns.some((c) => c.name === "tenant_id");
  return (table as Record<string, unknown>)["tenantId"] !== undefined;
}

// Grants for TenantDb's two escape hatches: db.global()'s write methods
// (write-handler-only) and ctx.db.unsafeRaw() (handler or hook, re-granted per hook).
export type TenantDbGrants = {
  readonly globalWrites?: EscapeHatchDeclaration;
  readonly unsafeRaw?: EscapeHatchDeclaration;
  readonly report?: EscapeHatchReporter;
  // Set for a resolved member principal (ctx.queryAsMember): no raw DbRunner leaves
  // this TenantDb, so no handler can COMMIT/RELEASE SAVEPOINT out of the READ ONLY scope.
  readonly memberReadOnly?: boolean;
  // Set only for an anonymous root without personalData: "public-intake" (write-origin.ts).
  readonly personalDataGate?: PersonalDataGate;
};

export type PersonalDataGate = (
  tableName: string,
  keys: readonly string[],
  entity?: EntityDefinition,
) => void;

const unsafeRawRebinders = new WeakMap<
  TenantDb,
  (grant: EscapeHatchDeclaration | undefined) => TenantDb
>();

// Rebinds tenantDb's unsafeRaw grant (e.g. a hook's own escapeHatch); inputs not built by
// createTenantDb pass through unchanged, without touching any property (ctx.db may be a throwing Proxy).
export function withUnsafeRawGrant(
  tenantDb: TenantDb,
  grant: EscapeHatchDeclaration | undefined,
): TenantDb {
  const rebind = unsafeRawRebinders.get(tenantDb);
  return rebind ? rebind(grant) : tenantDb;
}

const crossTenantRebinders = new WeakMap<TenantDb, (reason: string) => TenantDb>();

// Framework-private (not re-exported from db/index.ts): lifting the tenant filter needs a registered declaration.
export function acknowledgeConventionCrossTenant(tenantDb: TenantDb, reason: string): TenantDb {
  if (reason.trim().length === 0) {
    throw new Error("acknowledgeConventionCrossTenant requires a non-empty reason");
  }
  const rebind = crossTenantRebinders.get(tenantDb);
  if (!rebind) {
    throw new InternalError({
      message:
        "acknowledgeConventionCrossTenant received a TenantDb not built by createTenantDb — " +
        "no cross-tenant rebinder bound.",
    });
  }
  return rebind(reason);
}

export function createTenantDb(
  db: DbRunner,
  tenantId: TenantId,
  mode: TenantDbMode = "tenant",
  tracer?: Tracer,
  meter?: Meter,
  signal?: AbortSignal,
  grants?: TenantDbGrants,
): TenantDb {
  if (meter) registerStandardMetrics(meter);
  const report = grants?.report ?? fallbackEscapeHatchReporter(tenantId);

  function withDbSpan<T>(
    operation: "select" | "insert" | "update" | "delete",
    table: Table | EntityTableMeta,
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
  function readWhere(table: Table | EntityTableMeta, where?: WhereObject): WhereObject | undefined {
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

  function missingEscapeHatch(table: Table | EntityTableMeta): AccessDeniedError | undefined {
    if (hasGrant(grants?.globalWrites)) return undefined;
    return new AccessDeniedError({
      message:
        `db.global(${tableNameOf(table)}): write rejected — declare ` +
        `\`escapeHatch: { reason: "..." }\` on the write handler to allow ` +
        "writes through db.global().",
    });
  }

  function globalWriteReason(): string {
    return grants?.globalWrites?.reason ?? "";
  }

  function personalDataDenied(
    table: Table | EntityTableMeta,
    keys: readonly string[],
  ): AccessDeniedError | undefined {
    if (!grants?.personalDataGate) return undefined;
    try {
      grants.personalDataGate(tableNameOf(table), keys);
      return undefined;
    } catch (e) {
      if (e instanceof AccessDeniedError) return e;
      throw e;
    }
  }

  function foreignTenantOnGlobalWrite(
    table: Table | EntityTableMeta,
    tenantIdValue: unknown,
    message: string = `db.global(${tableNameOf(table)}): tenantId "${String(tenantIdValue)}" is not SYSTEM_TENANT_ID — a "global" table's rows must carry the system tenant, not an arbitrary tenant's id.`,
  ): AccessDeniedError | undefined {
    if (!isForeignTenantId(tenantIdValue)) return undefined;
    return new AccessDeniedError({ message });
  }

  function globalTable<TTable extends (SchemaTable | EntityTableMeta) & TenancyBrand<"global">>(
    table: TTable,
  ): GlobalTableDb<TTable> {
    const meta = asEntityTableMeta(table);
    if (meta?.tenancy !== "global") {
      throw new AccessDeniedError({
        message: `db.global(${tableNameOf(table)}): table is not declared \`tenancy: "global"\`.`,
      });
    }
    return {
      selectMany<T = Record<string, unknown>>(
        where?: WhereObject,
        options?: SelectOptions,
      ): Promise<readonly T[]> {
        return withDbSpan("select", table, async () => bunSelectMany<T>(db, table, where, options));
      },
      fetchOne<T = Record<string, unknown>>(where: WhereObject): Promise<T | undefined> {
        return withDbSpan("select", table, async () => bunFetchOne<T>(db, table, where));
      },
      insertOne<T = Record<string, unknown>>(
        values: Record<string, unknown>,
      ): Promise<T | undefined> {
        const denied =
          missingEscapeHatch(table) ??
          foreignTenantOnGlobalWrite(table, values["tenantId"]) ??
          personalDataDenied(table, Object.keys(values));
        if (denied) return Promise.reject(denied);
        report("global-write", globalWriteReason());
        return withDbSpan("insert", table, async () => bunInsertOne<T>(db, table, values));
      },
      updateMany<T = Record<string, unknown>>(
        set: Record<string, unknown>,
        where: WhereObject,
      ): Promise<readonly T[]> {
        const denied =
          missingEscapeHatch(table) ??
          foreignTenantOnGlobalWrite(table, set["tenantId"]) ??
          personalDataDenied(table, Object.keys(set));
        if (denied) return Promise.reject(denied);
        if (!where || Object.keys(where).length === 0) {
          return Promise.reject(
            new Error(
              "db.global().updateMany without where would mass-update every tenant's rows. Pass at least one where condition.",
            ),
          );
        }
        report("global-write", globalWriteReason());
        return withDbSpan("update", table, async () => bunUpdateMany<T>(db, table, set, where));
      },
      deleteMany(where: WhereObject): Promise<void> {
        const denied = missingEscapeHatch(table);
        if (denied) return Promise.reject(denied);
        if (!where || Object.keys(where).length === 0) {
          return Promise.reject(
            new Error(
              "db.global().deleteMany without where would mass-delete every tenant's rows. Pass at least one where condition.",
            ),
          );
        }
        report("global-write", globalWriteReason());
        return withDbSpan("delete", table, async () => bunDeleteMany(db, table, where));
      },
      // @cast-boundary type-brand — GlobalWrites is only present in the type when TTable is not ExecutorOnly; the object above always carries the methods.
    } as GlobalTableDb<TTable>;
  }

  function grantedUnsafeRawRunner(reason: string): DbRunner {
    if (reason.trim().length === 0) {
      throw new Error("unsafeRaw requires a non-empty reason");
    }
    // Ahead of the grant check: a declared escapeHatch must not buy a raw runner here either.
    if (grants?.memberReadOnly) {
      throw memberResolutionReadOnlyDenied();
    }
    if (!hasGrant(grants?.unsafeRaw)) {
      throw new AccessDeniedError({
        message:
          'ctx.db.unsafeRaw(reason): rejected — declare `escapeHatch: { reason: "..." }` on ' +
          "the handler or hook to allow unsafeRaw.",
      });
    }
    report("unsafe-raw", reason);
    return db;
  }

  const tenantDb: TenantDb = {
    tenantId,
    mode,
    global: globalTable,

    unsafeRaw: grantedUnsafeRawRunner,

    selectMany<T = Record<string, unknown>>(
      table: Table | EntityTableMeta,
      where?: WhereObject,
      options?: SelectOptions,
    ): Promise<readonly T[]> {
      const filter = readWhere(table, where);
      return withDbSpan("select", table, async () => bunSelectMany<T>(db, table, filter, options));
    },

    fetchOne<T = Record<string, unknown>>(
      table: Table | EntityTableMeta,
      where: WhereObject,
    ): Promise<T | undefined> {
      const filter = readWhere(table, where) ?? {};
      return withDbSpan("select", table, async () => bunFetchOne<T>(db, table, filter));
    },

    count(table: Table | EntityTableMeta, where?: WhereObject): Promise<number> {
      const filter = readWhere(table, where);
      return withDbSpan("select", table, async () => bunCountWhere(db, table, filter));
    },

    insertOne<T = Record<string, unknown>>(
      table: Table,
      values: Record<string, unknown>,
    ): Promise<T | undefined> {
      if (
        mode === "tenant" &&
        hasTenantColumn(table) &&
        asEntityTableMeta(table)?.tenancy === "global"
      ) {
        const denied = foreignTenantOnGlobalWrite(
          table,
          tenantId,
          `insertOne(${tableNameOf(table)}): "global" table rows must carry SYSTEM_TENANT_ID; ` +
            "use db.global(table) with escapeHatch instead.",
        );
        if (denied) return Promise.reject(denied);
      }
      const personalDenied = personalDataDenied(table, Object.keys(values));
      if (personalDenied) return Promise.reject(personalDenied);
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
      const personalDenied = personalDataDenied(table, Object.keys(set));
      if (personalDenied) return Promise.reject(personalDenied);
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

  declaredUnsafeRawRunners.set(tenantDb, grantedUnsafeRawRunner);
  unsafeRawRebinders.set(tenantDb, (grant) =>
    createTenantDb(db, tenantId, mode, tracer, meter, signal, { ...grants, unsafeRaw: grant }),
  );
  crossTenantRebinders.set(tenantDb, (reason) => {
    report("acknowledge-cross-tenant", reason);
    return createTenantDb(db, tenantId, "system", tracer, meter, signal, grants);
  });
  bindTenantDbRunner(tenantDb, db);
  if (grants?.personalDataGate) personalDataGates.set(tenantDb, grants.personalDataGate);
  return tenantDb;
}

export { asRawClient };
