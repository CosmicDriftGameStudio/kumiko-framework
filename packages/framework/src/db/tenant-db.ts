import type { AggregateRow, AggregateSpec } from "@cosmicdrift/kumiko-types/aggregate-types";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type {
  EscapeHatchDeclaration,
  EscapeHatchReporter,
  EscapeHatchTarget,
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
  aggregateWhere as bunAggregateWhere,
  countWhere as bunCountWhere,
  deleteMany as bunDeleteMany,
  fetchOne as bunFetchOne,
  insertOne as bunInsertOne,
  selectMany as bunSelectMany,
  updateMany as bunUpdateMany,
  runInNewTransaction,
  type SelectOptions,
  type WhereObject,
} from "../db/query.js";
import type { EntityDefinition } from "../engine/types/fields.js";
import { SYSTEM_TENANT_ID, type TenantId } from "../engine/types/identifiers.js";
import type { Registry } from "../engine/types/index.js";
import {
  AccessDeniedError,
  InternalError,
  memberResolutionReadOnlyDenied,
} from "../errors/index.js";
import {
  emitDbQuery,
  fallbackEscapeHatchReporter,
  type Meter,
  registerStandardMetrics,
  type Tracer,
} from "../observability/index.js";
import type { DbRunner } from "./connection.js";
import { bindProjectionRegistry, projectionRegistryOf } from "./projection-registry-binding.js";
import { bindTenantDbRunner, tenantDbRunner } from "./tenant-db-runner.js";

type Table = SchemaTable;

export {
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbMode,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";

const declaredUnsafeRawRunners = new WeakMap<
  TenantDb | UncheckedSystemDb,
  (declaredStepReason?: string) => DbRunner
>();

// The CRUD executor writes through tenantDbRunner, not insertOne, so it asks the
// TenantDb it was handed for its gate. Bound inside createTenantDb so rebound instances
// (withUnsafeRawGrant, acknowledgeConventionCrossTenant) carry it too.
const personalDataGates = new WeakMap<TenantDb, PersonalDataGate>();

// Lets createTenantDb(ctx.db.unsafeRaw(), ...) inherit the gate and the projection registry.
// Keyed by a per-grant proxy, never the shared pool/tx: tagging that would leak onto every sibling TenantDb.
const runnerPersonalDataGates = new WeakMap<DbRunner, PersonalDataGate>();

function boundRunner(
  runner: DbRunner,
  gate: PersonalDataGate | undefined,
  projectionRegistry: Registry | undefined,
): DbRunner {
  if (!gate && !projectionRegistry) return runner;
  const proxy = new Proxy(runner as object, {
    // Tagged-template calls need the real driver object as `this`.
    apply(target, _thisArg, args) {
      return Reflect.apply(target as (...callArgs: unknown[]) => unknown, target, args);
    },
    get(target, prop, _receiver) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "reserve") {
        // Bun.SQL and postgres.js hand back a raw connection; re-wrap it so the gate survives.
        return async (...args: unknown[]) => {
          const reserved: DbRunner = await Reflect.apply(value, target, args);
          return boundRunner(reserved, gate, projectionRegistry);
        };
      }
      if (
        prop === "begin" ||
        prop === "transaction" ||
        prop === "beginDistributed" ||
        prop === "savepoint"
      ) {
        // createTenantDb(tx, ...) inside the callback must inherit the gate too.
        return (...args: unknown[]) => {
          const callback = args[args.length - 1];
          if (typeof callback !== "function") {
            return Reflect.apply(value, target, args);
          }
          const gatedArgs = [
            ...args.slice(0, -1),
            (tx: unknown) => callback(boundRunner(tx as DbRunner, gate, projectionRegistry)),
          ];
          return Reflect.apply(value, target, gatedArgs);
        };
      }
      return value.bind(target);
    },
    // @cast-boundary proxy-erasure — Proxy<object> re-tags as the wrapped DbRunner shape.
  }) as DbRunner;
  if (gate) runnerPersonalDataGates.set(proxy, gate);
  if (projectionRegistry) bindProjectionRegistry(proxy, projectionRegistry);
  return proxy;
}

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
        "unsafeRawForDeclaredStep received a holder not built by createTenantDb, " +
        "createUncheckedSystemDb, or createSystemDbView — no declared unsafeRaw runner bound.",
    });
  }
  return runner(reason);
}

const systemDbRebinders = new WeakMap<
  UncheckedSystemDb,
  (grant: EscapeHatchDeclaration | undefined, deniedCallerLabel: string) => UncheckedSystemDb
>();

// Rebinds a hook's own escapeHatch onto ctx.systemDb, mirroring withUnsafeRawGrant: always
// rebuilt from the original db/dbOutsideTransaction/report, never stacked onto a prior rebind.
// Inputs not built by createUncheckedSystemDb pass through unchanged.
export function withSystemDbUnsafeRawGrant(
  systemDb: UncheckedSystemDb,
  grant: EscapeHatchDeclaration | undefined,
  deniedCallerLabel: string,
): UncheckedSystemDb {
  const rebind = systemDbRebinders.get(systemDb);
  return rebind ? rebind(grant, deniedCallerLabel) : systemDb;
}

// Ungated when `gate` is absent (the handler's own ctx.systemDb — systemScope() is
// itself the grant there). Gated by a hook's own escapeHatch when `gate.kind` is
// "hook-grant": unsafeRaw then denies without `hasGrant(gate.grant)`, same error shape
// as ctx.db.unsafeRaw's denial in createTenantDb below. Gated by the source TenantDb's
// own escapeHatch when `gate.kind` is "source-tenant-db" (createSystemDbView): unsafeRaw
// defers entirely to db's own declared runner (reason/memberReadOnly/grant check and
// report) — the view's own `report` is never called for unsafe-raw in that mode, and a
// source not built by createTenantDb fails closed.
function buildUncheckedSystemDb(
  db: TenantDb,
  dbOutsideTransaction: TenantDb | undefined,
  report: EscapeHatchReporter,
  gate?:
    | {
        readonly kind: "hook-grant";
        readonly grant: EscapeHatchDeclaration | undefined;
        readonly deniedCallerLabel: string;
      }
    | { readonly kind: "source-tenant-db" },
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

  function grantedUnsafeRawRunner(reason: string, forwardedDeclaredStep: boolean): DbRunner {
    if (gate?.kind === "source-tenant-db") {
      const sourceRunner = declaredUnsafeRawRunners.get(db);
      if (!sourceRunner) {
        throw new InternalError({
          message:
            "createSystemDbView received a TenantDb with no declared unsafeRaw runner bound.",
        });
      }
      return sourceRunner(forwardedDeclaredStep ? reason : undefined);
    }
    if (reason.trim().length === 0) {
      throw new Error("unsafeRaw requires a non-empty reason");
    }
    if (gate && !hasGrant(gate.grant)) {
      throw new AccessDeniedError({
        message:
          'ctx.systemDb.unsafeRaw(reason): rejected — declare `escapeHatch: { reason: "..." }` on ' +
          `${gate.deniedCallerLabel} to allow unsafeRaw.`,
      });
    }
    // Engine-forwarded steps carry their own declared reason; a caller-supplied one never reaches the audit trail.
    report("unsafe-raw", forwardedDeclaredStep ? reason : (gate?.grant?.reason ?? reason));
    const runner = tenantDbRunner(db);
    return boundRunner(runner, personalDataGates.get(db), projectionRegistryOf(db));
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

    unsafeRaw: (reason) => grantedUnsafeRawRunner(reason, false),

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
  declaredUnsafeRawRunners.set(uncheckedSystemDb, (declaredStepReason) => {
    if (declaredStepReason === undefined) {
      throw new InternalError({
        message: "A declared unsafeRaw runner on a system db requires the step reason.",
      });
    }
    return grantedUnsafeRawRunner(declaredStepReason, true);
  });
  if (gate?.kind !== "source-tenant-db") {
    systemDbRebinders.set(uncheckedSystemDb, (grant, deniedCallerLabel) =>
      buildUncheckedSystemDb(
        withUnsafeRawGrant(db, grant),
        dbOutsideTransaction && withUnsafeRawGrant(dbOutsideTransaction, grant),
        report,
        { kind: "hook-grant", grant, deniedCallerLabel },
      ),
    );
  }
  return uncheckedSystemDb;
}

// Framework-private (not re-exported from db/index.ts): buildHandlerContext
// (pipeline/dispatch-shared.ts) always builds "system" mode from the caller's
// own tenantId, never a foreign one.
//
// dbOutsideTransaction is optional so every existing single-arg call site
// (jobs/job-runner.ts, tests) keeps compiling — those callers have no
// outside-tx source to hand in and never needed one. Only
// buildHandlerContext passes it, which is also the only place `.outsideTransaction`
// is reachable through `ctx.systemDb`.
//
// Ungated here (the handler's own systemScope() is the grant); a hook's own
// escapeHatch is layered on afterwards via withSystemDbUnsafeRawGrant. Public
// callers use createSystemDbView instead, whose unsafeRaw follows the source
// TenantDb's own escapeHatch gate.
export function createUncheckedSystemDb(
  db: TenantDb,
  dbOutsideTransaction?: TenantDb,
  report: EscapeHatchReporter = fallbackEscapeHatchReporter(db.tenantId),
): UncheckedSystemDb {
  return buildUncheckedSystemDb(db, dbOutsideTransaction, report);
}

// Public: must never grant more raw access than the source TenantDb — unlike
// createUncheckedSystemDb (framework-private; r.systemScope()/a job IS the
// declaration), this view's unsafeRaw defers entirely to db's own escapeHatch gate.
export function createSystemDbView(
  db: TenantDb,
  dbOutsideTransaction?: TenantDb,
  report: EscapeHatchReporter = fallbackEscapeHatchReporter(db.tenantId),
): UncheckedSystemDb {
  return buildUncheckedSystemDb(db, dbOutsideTransaction, report, { kind: "source-tenant-db" });
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
  // Registry whose custom projections the EventStoreExecutor runs after each write
  // made through this TenantDb. Falls back to a registry bound to the runner.
  readonly projectionRegistry?: Registry;
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

const crossTenantRebinders = new WeakMap<
  TenantDb,
  (reason: string, deferReport: boolean) => TenantDb
>();
const crossTenantUseReporters = new WeakMap<TenantDb, (target?: EscapeHatchTarget) => void>();

// Framework-private (not re-exported from db/index.ts): lifting the tenant filter needs a registered declaration.
// `deferReport` leaves the audit entry to reportConventionCrossTenantUse, so a caller that learns
// which foreign row it touches can attach that row as the entry's target.
export function acknowledgeConventionCrossTenant(
  tenantDb: TenantDb,
  reason: string,
  options?: { readonly deferReport?: boolean },
): TenantDb {
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
  return rebind(reason, options?.deferReport === true);
}

// The report that acknowledgeConventionCrossTenant(..., { deferReport: true }) held back; the
// target keeps the 60s audit dedup from collapsing touches of different rows into one entry.
export function reportConventionCrossTenantUse(
  acknowledged: TenantDb,
  target?: EscapeHatchTarget,
): void {
  const reporter = crossTenantUseReporters.get(acknowledged);
  if (!reporter) {
    throw new InternalError({
      message:
        "reportConventionCrossTenantUse received a TenantDb not returned by " +
        "acknowledgeConventionCrossTenant.",
    });
  }
  reporter(target);
}

type OwnTransactionRunner = <T>(fn: (txDb: TenantDb) => Promise<T>) => Promise<T>;

const ownTransactionRebinders = new WeakMap<TenantDb, OwnTransactionRunner>();

export async function runInOwnTransaction<T>(
  tenantDb: TenantDb,
  fn: (txDb: TenantDb) => Promise<T>,
): Promise<T> {
  const rebind = ownTransactionRebinders.get(tenantDb);
  if (!rebind) {
    throw new InternalError({
      message:
        "runInOwnTransaction received a TenantDb not built by createTenantDb — " +
        "no transaction rebinder bound.",
    });
  }
  return rebind(fn);
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
  const personalDataGate = grants?.personalDataGate ?? runnerPersonalDataGates.get(db);
  const projectionRegistry = grants?.projectionRegistry ?? projectionRegistryOf(db);
  // Rebinders carry the resolved registry explicitly: a fresh tx handle is not tagged.
  const rebindGrants: TenantDbGrants | undefined =
    projectionRegistry && grants?.projectionRegistry === undefined
      ? { ...grants, projectionRegistry }
      : grants;

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

  // The ExecutorOnly brand is type-only; a type-erased table must still not reach the read model without an event.
  function executorManagedWriteDenied(
    table: Table | EntityTableMeta,
  ): AccessDeniedError | undefined {
    if (asEntityTableMeta(table)?.source === "unmanaged") return undefined;
    return new AccessDeniedError({
      message: `db.global(${tableNameOf(table)}): writes on executor-managed entity tables must go through the entity executor`,
    });
  }

  function globalWriteReason(): string {
    return grants?.globalWrites?.reason ?? "";
  }

  function personalDataDenied(
    table: Table | EntityTableMeta,
    keys: readonly string[],
  ): AccessDeniedError | undefined {
    if (!personalDataGate) return undefined;
    try {
      personalDataGate(tableNameOf(table), keys);
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

  // A tenant-mode write against a "global" table can never match (rows carry SYSTEM_TENANT_ID, writeWhere pins the caller's tenant), so reject loudly instead of silently affecting zero rows.
  function tenantWriteOnGlobalTable(
    table: Table,
    method: "updateMany" | "deleteMany",
  ): AccessDeniedError | undefined {
    if (mode !== "tenant" || !hasTenantColumn(table)) return undefined;
    if (asEntityTableMeta(table)?.tenancy !== "global") return undefined;
    return new AccessDeniedError({
      message:
        `${method}(${tableNameOf(table)}): "global" table rows carry SYSTEM_TENANT_ID and never match the caller's tenant; ` +
        "use db.global(table) with escapeHatch instead.",
    });
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
          executorManagedWriteDenied(table) ??
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
          executorManagedWriteDenied(table) ??
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
        const denied = missingEscapeHatch(table) ?? executorManagedWriteDenied(table);
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

  function grantedUnsafeRawRunner(declaredStepReason?: string): DbRunner {
    // Ahead of the grant check: a declared escapeHatch must not buy a raw runner here either.
    if (grants?.memberReadOnly) {
      throw memberResolutionReadOnlyDenied();
    }
    if (!hasGrant(grants?.unsafeRaw)) {
      throw new AccessDeniedError({
        message:
          'ctx.db.unsafeRaw(): rejected — declare `escapeHatch: { reason: "..." }` on ' +
          "the handler or hook to allow unsafeRaw.",
      });
    }
    // Engine-forwarded steps carry their own declared reason; otherwise the grant's reason is audited.
    report("unsafe-raw", declaredStepReason ?? grants?.unsafeRaw?.reason ?? "");
    return boundRunner(db, personalDataGate, projectionRegistry);
  }

  const tenantDb: TenantDb = {
    tenantId,
    mode,
    global: globalTable,

    unsafeRaw: () => grantedUnsafeRawRunner(),

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

    aggregate(
      table: Table | EntityTableMeta,
      spec: AggregateSpec,
      where?: WhereObject,
    ): Promise<readonly AggregateRow[]> {
      const filter = readWhere(table, where);
      return withDbSpan("select", table, async () => bunAggregateWhere(db, table, spec, filter));
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
      const globalDenied = tenantWriteOnGlobalTable(table, "updateMany");
      if (globalDenied) return Promise.reject(globalDenied);
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
      const globalDenied = tenantWriteOnGlobalTable(table, "deleteMany");
      if (globalDenied) return Promise.reject(globalDenied);
      const filter = writeWhere(table, where);
      return withDbSpan("delete", table, async () => bunDeleteMany(db, table, filter));
    },
  };

  declaredUnsafeRawRunners.set(tenantDb, grantedUnsafeRawRunner);
  unsafeRawRebinders.set(tenantDb, (grant) =>
    createTenantDb(db, tenantId, mode, tracer, meter, signal, {
      ...rebindGrants,
      unsafeRaw: grant,
      // db.global() writes are write-handler-only: a rebind (a hook's own grant) must not inherit them.
      globalWrites: undefined,
    }),
  );
  crossTenantRebinders.set(tenantDb, (reason, deferReport) => {
    if (!deferReport) report("acknowledge-cross-tenant", reason);
    const acknowledged = createTenantDb(
      db,
      tenantId,
      "system",
      tracer,
      meter,
      signal,
      rebindGrants,
    );
    crossTenantUseReporters.set(acknowledged, (target) =>
      report("acknowledge-cross-tenant", reason, target),
    );
    return acknowledged;
  });
  ownTransactionRebinders.set(tenantDb, async (fn) => {
    if (grants?.memberReadOnly) {
      throw new InternalError({
        message:
          "runInOwnTransaction: memberReadOnly TenantDb — a fresh transaction would escape " +
          "the enforced read-only scope.",
      });
    }
    // Carries a runner-bound gate (grants.personalDataGate unset, resolved via the fallback above) forward explicitly, since the fresh tx-handle isn't itself registered in runnerPersonalDataGates.
    const txGrants = personalDataGate ? { ...rebindGrants, personalDataGate } : rebindGrants;
    return runInNewTransaction(db, (tx) =>
      fn(createTenantDb(tx, tenantId, mode, tracer, meter, signal, txGrants)),
    );
  });
  bindTenantDbRunner(tenantDb, db);
  if (personalDataGate) personalDataGates.set(tenantDb, personalDataGate);
  if (projectionRegistry) bindProjectionRegistry(tenantDb, projectionRegistry);
  return tenantDb;
}

export { asRawClient };
