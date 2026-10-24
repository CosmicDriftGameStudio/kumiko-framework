import type { AggregateRow, AggregateSpec } from "@cosmicdrift/kumiko-types/aggregate-types";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import type {
  EscapeHatchDeclaration,
  EscapeHatchReporter,
  EscapeHatchTarget,
} from "@cosmicdrift/kumiko-types/handlers";
import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";
import {
  type ExecutorManagedTenantDb,
  type GlobalTableDb,
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbUpsertOptions,
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
  type SelectOptions,
  type WhereObject,
} from "../db/query.ts";
import { assertReason } from "../engine/escape-hatch-reason.ts";
import type { EntityDefinition } from "../engine/types/fields.ts";
import { SYSTEM_TENANT_ID, type TenantId } from "../engine/types/identifiers.ts";
import type { Registry } from "../engine/types/index.ts";
import {
  AccessDeniedError,
  InternalError,
  memberResolutionReadOnlyDenied,
} from "../errors/index.ts";
import {
  fallbackEscapeHatchReporter,
  type Meter,
  registerStandardMetrics,
  type Tracer,
} from "../observability/index.ts";
import type { DbRunner } from "./connection.ts";
import {
  assertWritableTable,
  executorManagedWriteDenied,
  hasExecutorManagedWriteCapability,
  registerExecutorManagedWriteRunner,
} from "./executor-managed-tables.ts";
import { bindProjectionRegistry, projectionRegistryOf } from "./projection-registry-binding.ts";
import { acquireNamespacedAdvisoryLock } from "./queries/advisory-lock.ts";
import { queryDatabaseNow } from "./queries/database-now.ts";
import {
  systemModeOptions,
  type TenantDbModeOptions,
  unsafeRawScopedRunner,
  unscopedRunnerOf,
} from "./row-level-security-scope.ts";
import { hasFieldProperty, tableNameOf } from "./table-introspection.ts";
import {
  bindTenantDbRunner,
  denyTenantDbWrites,
  tenantDbRunner,
  tenantDbWritesDeniedError,
} from "./tenant-db-runner.ts";
import { registerScopedRebinder } from "./tenant-db-scoped-rebind.ts";
import { createTenantDbStatementRunner } from "./tenant-db-statement-runner.ts";
import { upsertTableDenied, upsertTenantRow } from "./tenant-db-upsert.ts";
import {
  isForeignTenantId,
  requestedTenantIds,
  tenantIdsAfterExclusion,
} from "./tenant-id-filter.ts";
import { registerRunnerProxyTarget } from "./transaction-serialization.ts";

type Table = SchemaTable;

export {
  type ExecutorManagedTenantDb,
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
  executorManagedWrites: boolean,
): DbRunner {
  if (!gate && !projectionRegistry && !executorManagedWrites) return runner;
  const proxy = new Proxy(runner, {
    // Tagged-template calls need the real driver object as `this`.
    apply(target, _thisArg, args) {
      if (typeof target !== "function") {
        throw new TypeError("tenant-db runner proxy applied on a non-callable runner");
      }
      return Reflect.apply(target, target, args);
    },
    get(target, prop, _receiver) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "reserve") {
        // The driver hands back a raw connection; re-wrap it so the gate survives.
        return async (...args: unknown[]) => {
          const reserved: DbRunner = await Reflect.apply(value, target, args);
          return boundRunner(reserved, gate, projectionRegistry, executorManagedWrites);
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
            (tx: unknown) => {
              // @cast-boundary db-runner — driver callback hands over the tx handle untyped
              const txRunner = tx as DbRunner;
              return callback(
                boundRunner(txRunner, gate, projectionRegistry, executorManagedWrites),
              );
            },
          ];
          return Reflect.apply(value, target, gatedArgs);
        };
      }
      return value.bind(target);
    },
  });
  registerRunnerProxyTarget(proxy, runner);
  if (gate) runnerPersonalDataGates.set(proxy, gate);
  if (projectionRegistry) bindProjectionRegistry(proxy, projectionRegistry);
  if (executorManagedWrites) {
    registerExecutorManagedWriteRunner(proxy);
    capableRunnerInners.set(proxy, runner);
  }
  return proxy;
}

const capableRunnerInners = new WeakMap<DbRunner, DbRunner>();
const capableRunnerByInner = new WeakMap<DbRunner, ExecutorManagedRunner>();

// Framework-private (not re-exported from db/index.ts): the only way to obtain a runner that may
// write executor-managed tables. Only the framework's own event-apply paths call it.
export function withExecutorManagedWrites(runner: DbRunner): ExecutorManagedRunner {
  if (hasExecutorManagedWriteCapability(runner)) return runner;
  const cached = capableRunnerByInner.get(runner);
  if (cached) return cached;
  const capable = boundRunner(
    runner,
    runnerPersonalDataGates.get(runner),
    projectionRegistryOf(runner),
    true,
  );
  if (!hasExecutorManagedWriteCapability(capable)) {
    throw new InternalError({
      message: "boundRunner did not register the executor write capability",
    });
  }
  capableRunnerByInner.set(runner, capable);
  return capable;
}

// unsafeRaw must not hand out the executor-only write capability, even from a capable runner.
export function withoutExecutorManagedWrites(runner: DbRunner): DbRunner {
  return capableRunnerInners.get(runner) ?? runner;
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
  assertReason("unsafeRawForDeclaredStep", reason);
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
  object,
  (grant: EscapeHatchDeclaration | undefined, deniedCallerLabel: string) => UncheckedSystemDb
>();

// Rebinds a hook's own escapeHatch onto ctx.systemDb, mirroring withUnsafeRawGrant: always
// rebuilt from the original db/dbOutsideTransaction/report, never stacked onto a prior rebind.
// Inputs not built by createUncheckedSystemDb pass through unchanged.
export function withSystemDbUnsafeRawGrant<T extends object>(
  systemDb: T,
  grant: EscapeHatchDeclaration | undefined,
  deniedCallerLabel: string,
): T | UncheckedSystemDb {
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
  function requireSystemOutsideTransactionDb(): TenantDb {
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
    assertReason("ctx.systemDb.unsafeRaw(reason)", reason);
    if (gate && !hasGrant(gate.grant)) {
      throw new AccessDeniedError({
        message:
          'ctx.systemDb.unsafeRaw(reason): rejected — declare `escapeHatch: { reason: "..." }` on ' +
          `${gate.deniedCallerLabel} to allow unsafeRaw.`,
      });
    }
    // A granted unsafeRaw is a declared, audited bypass of the TenantDb filter, so row-level security does not narrow it either.
    // Engine-forwarded steps carry their own declared reason; a caller-supplied one never reaches the audit trail.
    report("unsafe-raw", forwardedDeclaredStep ? reason : (gate?.grant?.reason ?? reason));
    const runner = unsafeRawScopedRunner(withoutExecutorManagedWrites(tenantDbRunner(db)));
    return boundRunner(runner, personalDataGates.get(db), projectionRegistryOf(db), false);
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
        (row) => !allowedTenantIds.some((allowed) => allowed === row[tenantField]),
      );
      if (hasOffender) {
        throw new AccessDeniedError({
          message: `systemScope() row tenant self-check failed on field "${String(tenantField)}"`,
        });
      }
      return rows;
    },

    acknowledgeCrossTenant(reason) {
      assertReason("acknowledgeCrossTenant(reason)", reason);
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
        return requireSystemOutsideTransactionDb();
      },

      acknowledgeCrossTenant(reason) {
        assertReason("acknowledgeCrossTenant(reason)", reason);
        const result = requireSystemOutsideTransactionDb();
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

export { requestedTenantIds } from "./tenant-id-filter.ts";
export { tableNameOf };

// A grant is only real when its reason is non-empty — `{ reason: "" }` must not silently unlock it.
function hasGrant(decl: EscapeHatchDeclaration | undefined): boolean {
  return decl !== undefined && decl.reason.trim().length > 0;
}

// Checks the canonical EntityTableMeta (branded EntityTable's KUMIKO_META_SYMBOL
// or a plain deriveEntityTableMeta/defineUnmanagedTable result), not a direct
// `table.tenantId` property read — the latter only exists on branded EntityTables
// and silently returned false (no tenant filter!) for plain EntityTableMeta
// tables like unmanaged direct-write stores, e.g. userSessionTable.
export function hasTenantColumn(table: Table | EntityTableMeta): boolean {
  const meta = asEntityTableMeta(table);
  if (meta) return meta.columns.some((c) => c.name === "tenant_id");
  return hasFieldProperty(table, "tenantId");
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
  // Set for contexts that hold no open transaction: insertOne/updateMany/deleteMany, db.global() writes
  // and the executor's runner-based writes reject. unsafeRaw stays open as the audited escape hatch.
  readonly writesDeniedReason?: string;
};

export type PersonalDataGate = (
  tableName: string,
  keys: readonly string[],
  entity?: EntityDefinition,
) => void;

const unsafeRawRebinders = new WeakMap<
  object,
  (grant: EscapeHatchDeclaration | undefined) => TenantDb
>();

// Rebinds tenantDb's unsafeRaw grant (e.g. a hook's own escapeHatch); inputs not built by
// createTenantDb pass through unchanged, without touching any property (ctx.db may be a throwing Proxy).
export function withUnsafeRawGrant<T extends object>(
  tenantDb: T,
  grant: EscapeHatchDeclaration | undefined,
): T | TenantDb {
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
  assertReason("acknowledgeConventionCrossTenant", reason);
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

export type OutsideTransactionContext = { readonly dbOutsideTransaction: TenantDb | undefined };

export function hasOutsideTransactionDb(
  ctx: OutsideTransactionContext,
): ctx is OutsideTransactionContext & { readonly dbOutsideTransaction: TenantDb } {
  return ctx.dbOutsideTransaction !== undefined;
}

export function requireOutsideTransactionDb(ctx: OutsideTransactionContext): TenantDb {
  if (!hasOutsideTransactionDb(ctx)) {
    throw new InternalError({
      message:
        "ctx.dbOutsideTransaction is not available in this dispatch phase (member-resolution, before-transaction denial) or metering tenant mode.",
    });
  }
  return ctx.dbOutsideTransaction;
}

export type CreateTenantDbOptions = {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly signal?: AbortSignal;
  readonly grants?: TenantDbGrants;
} & (
  | { readonly mode?: "tenant"; readonly reason?: undefined }
  | { readonly mode: "system"; readonly reason: string }
);

export function createTenantDb(
  options: CreateTenantDbOptions & { readonly db: ExecutorManagedRunner },
): ExecutorManagedTenantDb;
export function createTenantDb(options: CreateTenantDbOptions): TenantDb;
export function createTenantDb(options: CreateTenantDbOptions): TenantDb {
  return buildTenantDb(options);
}

// Tenant-destroy hooks purge their own tenant's event-fed rows; the pinned tenant is the only reach and unsafeRaw stays without the write capability.
export function createTenantDataDestroyDb(
  options: Omit<CreateTenantDbOptions, "mode" | "reason">,
): ExecutorManagedTenantDb {
  return createTenantDb({ ...options, db: withExecutorManagedWrites(options.db), mode: "tenant" });
}

// Untyped JS callers or an `as` cast can still hand in undefined; a scoped handle
// without a tenant would bind `tenant_id = NULL` instead of failing loudly.
function buildTenantDb(
  options: Omit<CreateTenantDbOptions, "tenantId"> & { readonly tenantId: TenantId | undefined },
): TenantDb {
  const {
    db: givenDb,
    tenantId,
    mode = "tenant",
    reason: systemReason,
    tracer,
    meter,
    signal,
    grants,
  } = options;
  const modeOptions: TenantDbModeOptions =
    mode === "system" ? systemModeOptions(systemReason) : { mode: "tenant" };
  const db = mode === "system" ? givenDb : unscopedRunnerOf(givenDb);
  if (tenantId === undefined) {
    throw new InternalError({ message: "createTenantDb: tenantId is required" });
  }
  if (meter) registerStandardMetrics(meter);
  const report = grants?.report ?? fallbackEscapeHatchReporter(tenantId);
  const personalDataGate = grants?.personalDataGate ?? runnerPersonalDataGates.get(db);
  const projectionRegistry = grants?.projectionRegistry ?? projectionRegistryOf(db);
  // Rebinders carry the resolved registry explicitly: a fresh tx handle is not tagged.
  const rebindGrants: TenantDbGrants | undefined =
    projectionRegistry && grants?.projectionRegistry === undefined
      ? { ...grants, projectionRegistry }
      : grants;

  const withDbSpan = createTenantDbStatementRunner({
    tracer,
    meter,
    signal,
    ...modeOptions,
    tenantId,
  });

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
      const requestedList = requestedTenantIds(requested);
      // An explicit exclusion or empty list must keep excluding, never widen to the full scope.
      if (requestedList === undefined) {
        return { ...where, tenantId: tenantIdsAfterExclusion(requested, allowed) ?? allowed };
      }
      if (requestedList.length === 0) return { ...where, tenantId: [] };
      const narrowed = requestedList.filter(
        (t): t is string => typeof t === "string" && allowed.includes(t),
      );
      return { ...where, tenantId: narrowed.length > 0 ? narrowed : allowed };
    }
    const tenantFilter: WhereObject = { tenantId: allowed };
    return where ? { ...where, ...tenantFilter } : tenantFilter;
  }

  function writeWhere(table: Table | EntityTableMeta, where: WhereObject): WhereObject {
    if (!hasTenantColumn(table) || mode === "system") return where;
    return { ...where, tenantId };
  }

  function insertValues(
    table: Table | EntityTableMeta,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
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

  function writesDenied(operation: string): InternalError | undefined {
    const reason = grants?.writesDeniedReason;
    return reason === undefined ? undefined : tenantDbWritesDeniedError(operation, reason);
  }

  function globalWriteReason(): string {
    return grants?.globalWrites?.reason ?? "";
  }

  // The table is the audit target: process-level dedup would otherwise collapse a cron's
  // writes to several global tables into one audit entry.
  function reportGlobalWrite(table: Table | EntityTableMeta): void {
    report("global-write", globalWriteReason(), {
      id: tableNameOf(table),
      tenantId: tenantId ?? SYSTEM_TENANT_ID,
    });
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
    table: Table | EntityTableMeta,
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

  // Callers ran executorManagedWriteDenied first: either db holds the capability or the table is
  // unmanaged. The split only proves to the compiler which overload of the free writers applies.
  function insertRow<T>(
    table: Table | EntityTableMeta,
    values: Record<string, unknown>,
  ): Promise<T | undefined> {
    if (hasExecutorManagedWriteCapability(db)) return bunInsertOne<T>(db, table, values);
    assertWritableTable(table);
    return bunInsertOne<T>(db, table, values);
  }

  function updateRows<T>(
    table: Table | EntityTableMeta,
    set: Record<string, unknown>,
    where: WhereObject,
  ): Promise<readonly T[]> {
    if (hasExecutorManagedWriteCapability(db)) return bunUpdateMany<T>(db, table, set, where);
    assertWritableTable(table);
    return bunUpdateMany<T>(db, table, set, where);
  }

  function deleteRows(table: Table | EntityTableMeta, where: WhereObject): Promise<number> {
    if (hasExecutorManagedWriteCapability(db)) return bunDeleteMany(db, table, where);
    assertWritableTable(table);
    return bunDeleteMany(db, table, where);
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
          writesDenied("ctx.db.global().insertOne") ??
          missingEscapeHatch(table) ??
          executorManagedWriteDenied(db, table, "db.global().insertOne") ??
          foreignTenantOnGlobalWrite(table, values["tenantId"]) ??
          personalDataDenied(table, Object.keys(values));
        if (denied) return Promise.reject(denied);
        reportGlobalWrite(table);
        return withDbSpan("insert", table, async () => insertRow<T>(table, values));
      },
      updateMany<T = Record<string, unknown>>(
        set: Record<string, unknown>,
        where: WhereObject,
      ): Promise<readonly T[]> {
        const denied =
          writesDenied("ctx.db.global().updateMany") ??
          missingEscapeHatch(table) ??
          executorManagedWriteDenied(db, table, "db.global().updateMany") ??
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
        reportGlobalWrite(table);
        return withDbSpan("update", table, async () => updateRows<T>(table, set, where));
      },
      deleteMany(where: WhereObject): Promise<void> {
        const denied =
          writesDenied("ctx.db.global().deleteMany") ??
          missingEscapeHatch(table) ??
          executorManagedWriteDenied(db, table, "db.global().deleteMany");
        if (denied) return Promise.reject(denied);
        if (!where || Object.keys(where).length === 0) {
          return Promise.reject(
            new Error(
              "db.global().deleteMany without where would mass-delete every tenant's rows. Pass at least one where condition.",
            ),
          );
        }
        reportGlobalWrite(table);
        return withDbSpan("delete", table, async () => {
          await deleteRows(table, where);
        });
      },
      // @cast-boundary phantom-brand — GlobalWrites is only present in the type when TTable carries Writable; the object above always carries the methods.
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
    return boundRunner(
      unsafeRawScopedRunner(withoutExecutorManagedWrites(db)),
      personalDataGate,
      projectionRegistry,
      false,
    );
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

    advisoryXactLock(namespace: number, key: string): Promise<void> {
      return acquireNamespacedAdvisoryLock(db, namespace, `${tenantId}:${key}`);
    },

    databaseNow(): Promise<Date> {
      return queryDatabaseNow(db);
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
      table: Table | EntityTableMeta,
      values: Record<string, unknown>,
    ): Promise<T | undefined> {
      const writeDenied = writesDenied("ctx.db.insertOne");
      if (writeDenied) return Promise.reject(writeDenied);
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
      const managedDenied = executorManagedWriteDenied(db, table, "ctx.db.insertOne");
      if (managedDenied) return Promise.reject(managedDenied);
      const data = insertValues(table, values);
      return withDbSpan("insert", table, async () => insertRow<T>(table, data));
    },

    upsert<T = Record<string, unknown>>(
      table: Table | EntityTableMeta,
      values: Record<string, unknown>,
      options: TenantDbUpsertOptions,
    ): Promise<T | undefined> {
      const denied =
        writesDenied("ctx.db.upsert") ??
        upsertTableDenied(table, mode) ??
        personalDataDenied(table, [...Object.keys(values), ...Object.keys(options.update ?? {})]);
      if (denied) return Promise.reject(denied);
      const data = insertValues(table, values);
      return withDbSpan("insert", table, () => upsertTenantRow<T>(db, table, data, options));
    },

    updateMany<T = Record<string, unknown>>(
      table: Table | EntityTableMeta,
      set: Record<string, unknown>,
      where: WhereObject,
    ): Promise<readonly T[]> {
      const writeDenied = writesDenied("ctx.db.updateMany");
      if (writeDenied) return Promise.reject(writeDenied);
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
      const managedDenied = executorManagedWriteDenied(db, table, "ctx.db.updateMany");
      if (managedDenied) return Promise.reject(managedDenied);
      const filter = writeWhere(table, where);
      return withDbSpan("update", table, async () => updateRows<T>(table, set, filter));
    },

    deleteMany(table: Table | EntityTableMeta, where: WhereObject): Promise<number> {
      const writeDenied = writesDenied("ctx.db.deleteMany");
      if (writeDenied) return Promise.reject(writeDenied);
      if (!where || Object.keys(where).length === 0) {
        return Promise.reject(
          new Error(
            "TenantDb.deleteMany without where would mass-delete all tenant rows. Pass at least one where condition.",
          ),
        );
      }
      const globalDenied = tenantWriteOnGlobalTable(table, "deleteMany");
      if (globalDenied) return Promise.reject(globalDenied);
      const managedDenied = executorManagedWriteDenied(db, table, "ctx.db.deleteMany");
      if (managedDenied) return Promise.reject(managedDenied);
      const filter = writeWhere(table, where);
      return withDbSpan("delete", table, async () => deleteRows(table, filter));
    },
  };

  declaredUnsafeRawRunners.set(tenantDb, grantedUnsafeRawRunner);
  unsafeRawRebinders.set(tenantDb, (grant) =>
    createTenantDb({
      db,
      tenantId,
      ...modeOptions,
      tracer,
      meter,
      signal,
      grants: {
        ...rebindGrants,
        unsafeRaw: grant,
        // db.global() writes are write-handler-only: a rebind (a hook's own grant) must not inherit them.
        globalWrites: undefined,
      },
    }),
  );
  crossTenantRebinders.set(tenantDb, (reason, deferReport) => {
    if (!deferReport) report("acknowledge-cross-tenant", reason);
    const acknowledged = createTenantDb({
      db,
      tenantId,
      mode: "system",
      reason,
      tracer,
      meter,
      signal,
      grants: rebindGrants,
    });
    crossTenantUseReporters.set(acknowledged, (target) =>
      report("acknowledge-cross-tenant", reason, target),
    );
    return acknowledged;
  });
  // Carries a runner-bound gate (grants.personalDataGate unset, resolved via the fallback above) forward explicitly, since a fresh tx-handle isn't itself registered in runnerPersonalDataGates.
  const scopedGrants = personalDataGate ? { ...rebindGrants, personalDataGate } : rebindGrants;
  registerScopedRebinder(tenantDb, {
    memberReadOnly: grants?.memberReadOnly === true,
    rebind: (runner) =>
      createTenantDb({
        db: runner,
        tenantId,
        ...modeOptions,
        tracer,
        meter,
        signal,
        grants: scopedGrants,
      }),
  });
  // Framework code reading through the raw runner (executor list/detail) must follow the db's own mode, not the ambient scope.
  bindTenantDbRunner(tenantDb, db, modeOptions, tenantId);
  if (grants?.writesDeniedReason !== undefined) {
    denyTenantDbWrites(tenantDb, grants.writesDeniedReason);
  }
  if (personalDataGate) personalDataGates.set(tenantDb, personalDataGate);
  if (projectionRegistry) bindProjectionRegistry(tenantDb, projectionRegistry);
  return tenantDb;
}

// Tenant-mode TenantDb whose writes reach the registry's custom projections.
export function createProjectingTenantDb(
  db: DbRunner,
  tenantId: TenantId,
  projectionRegistry: Registry | undefined,
): TenantDb {
  return createTenantDb({
    db,
    tenantId,
    mode: "tenant",
    grants: projectionRegistry ? { projectionRegistry } : undefined,
  });
}

export { asRawClient };
