import type { AggregateRow, AggregateSpec } from "@cosmicdrift/kumiko-types/aggregate-types";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type { DbConnection } from "@cosmicdrift/kumiko-types/db-connection";
import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import type { HandlerDb } from "@cosmicdrift/kumiko-types/handlers";
import type { Meter, Tracer } from "@cosmicdrift/kumiko-types/observability";
import type { SchemaTable } from "@cosmicdrift/kumiko-types/schema-table-types";
import type { TenancyBrand } from "@cosmicdrift/kumiko-types/tenancy-brand";
import {
  type ConnectionTenantDb,
  type ExecutorManagedTenantDb,
  type GlobalTableDb,
  type TenantDb,
  type TenantDbUpsertOptions,
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
import { SYSTEM_TENANT_ID, type TenantId } from "../engine/types/identifiers.ts";
import type { Registry } from "../engine/types/index.ts";
import { AccessDeniedError, InternalError } from "../errors/index.ts";
import { memberResolutionReadOnlyDenied } from "../errors/member-resolution.ts";
import { fallbackEscapeHatchReporter } from "../observability/escape-hatch-report.ts";
import { registerStandardMetrics } from "../observability/standard-metrics.ts";

import type { DbRunner } from "./connection.ts";
import {
  assertWritableTable,
  executorManagedWriteDenied,
  hasExecutorManagedWriteCapability,
} from "./executor-managed-tables.ts";
import { bindProjectionRegistry } from "./projection-registry-binding.ts";
import { acquireNamespacedAdvisoryLock } from "./queries/advisory-lock.ts";
import { queryDatabaseNow } from "./queries/database-now.ts";
import {
  systemModeOptions,
  type TenantDbModeOptions,
  tenantDbRowLevelSecurityScope,
  unsafeRawScopedRunner,
  unscopedRunnerOf,
  withRowLevelSecurityScope,
} from "./row-level-security-scope.ts";
import { hasFieldProperty, tableNameOf } from "./table-introspection.ts";
import {
  appProjectionRegistryOf,
  boundRunner,
  crossTenantRebinders,
  crossTenantUseReporters,
  declaredUnsafeRawRunners,
  hasGrant,
  personalDataGates,
  runnerPersonalDataGates,
  type TenantDbGrants,
  tenantScopeRebinders,
  unsafeRawRebinders,
  withExecutorManagedWrites,
  withoutExecutorManagedWrites,
} from "./tenant-db-runner-binding.ts";
import {
  bindTenantDbRunner,
  denyTenantDbWrites,
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

type Table = SchemaTable;

type UnsafeRawReach = "own-scope" | "all-tenants";

const unsafeRawRunners = new WeakSet<object>();

export function isUnsafeRawRunner(runner: unknown): boolean {
  return (
    (typeof runner === "object" || typeof runner === "function") &&
    runner !== null &&
    unsafeRawRunners.has(runner)
  );
}

export {
  type ConnectionTenantDb,
  type ExecutorManagedTenantDb,
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type TenantDbMode,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";
export {
  acknowledgeConventionCrossTenant,
  assertPersonalDataWrite,
  bindAppProjectionRegistry,
  type PersonalDataGate,
  reportConventionCrossTenantUse,
  scopeTenantDbToTenant,
  type TenantDbGrants,
  unsafeRawForDeclaredStep,
  withExecutorManagedWrites,
  withoutExecutorManagedWrites,
  withUnsafeRawGrant,
} from "./tenant-db-runner-binding.ts";
export {
  createSystemDbView,
  createUncheckedSystemDb,
  withSystemDbUnsafeRawGrant,
} from "./tenant-db-system-db.ts";

// @cast-boundary tenant-db-row
export function castTenantRows<T>(rows: readonly Record<string, unknown>[]): readonly T[] {
  return rows as unknown as readonly T[];
}

export { requestedTenantIds } from "./tenant-id-filter.ts";
export { tableNameOf };

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


export type OutsideTransactionContext = { readonly db: Pick<HandlerDb, "outsideTransaction"> };

export function hasOutsideTransactionDb(
  ctx: OutsideTransactionContext,
): ctx is { readonly db: { readonly outsideTransaction: TenantDb } } {
  return ctx.db.outsideTransaction !== undefined;
}

export function requireOutsideTransactionDb(ctx: OutsideTransactionContext): TenantDb {
  if (!hasOutsideTransactionDb(ctx)) {
    throw new InternalError({
      message:
        "ctx.db.outsideTransaction is not available in this dispatch phase (member-resolution, before-transaction denial) or metering tenant mode.",
    });
  }
  return ctx.db.outsideTransaction;
}

export function requireSystemDb<TSystemDb>(
  ctx: { readonly systemDb?: TSystemDb },
  callerName: string,
): NonNullable<TSystemDb> {
  if (!ctx.systemDb) {
    throw new InternalError({
      message: `${callerName} requires ctx.systemDb — is r.systemScope() set on the feature?`,
    });
  }
  return ctx.systemDb;
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
export function createTenantDb(
  options: CreateTenantDbOptions & { readonly db: DbConnection },
): ConnectionTenantDb;
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
    tenantId: requestedTenantId,
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
  if (requestedTenantId === undefined) {
    throw new InternalError({ message: "createTenantDb: tenantId is required" });
  }
  const tenantId: TenantId = requestedTenantId;
  if (meter) registerStandardMetrics(meter);
  const report = grants?.report ?? fallbackEscapeHatchReporter(tenantId);
  const personalDataGate = grants?.personalDataGate ?? runnerPersonalDataGates.get(db);
  const projectionRegistry = grants?.projectionRegistry ?? appProjectionRegistryOf(givenDb);
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
        `\`escapeHatch: { reason: "...", grants: ["globalWrites"] }\` on the write handler to allow ` +
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

  // upsert refuses the same in its update; WITH CHECK only catches it while row level security is on.
  function tenantIdInSetDenied(
    table: Table | EntityTableMeta,
    set: Record<string, unknown>,
  ): AccessDeniedError | undefined {
    if (mode !== "tenant" || !hasTenantColumn(table)) return undefined;
    if (!Object.hasOwn(set, "tenantId") && !Object.hasOwn(set, "tenant_id")) return undefined;
    return new AccessDeniedError({
      message: `updateMany(${tableNameOf(table)}): set must not change "tenantId" — it would move the row into another tenant.`,
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

  function grantedUnsafeRawRunner(reach: UnsafeRawReach, declaredStepReason?: string): DbRunner {
    // Ahead of the grant check: a declared escapeHatch must not buy a raw runner here either.
    if (grants?.memberReadOnly) {
      throw memberResolutionReadOnlyDenied();
    }
    if (!hasGrant(grants?.unsafeRaw)) {
      throw new AccessDeniedError({
        message:
          `ctx.db.${reach === "all-tenants" ? "unsafeRawAllTenants" : "unsafeRaw"}(): rejected — ` +
          'declare `escapeHatch: { reason: "...", grants: ["unsafeRaw"] }` on ' +
          "the handler or hook to allow unsafeRaw.",
      });
    }
    // Engine-forwarded steps carry their own declared reason; otherwise the grant's reason is audited.
    report("unsafe-raw", declaredStepReason ?? grants?.unsafeRaw?.reason ?? "");
    const bound = boundRunner(
      reach === "all-tenants"
        ? unsafeRawScopedRunner(withoutExecutorManagedWrites(db))
        : withRowLevelSecurityScope(
            withoutExecutorManagedWrites(db),
            tenantDbRowLevelSecurityScope(modeOptions, tenantId),
          ),
      personalDataGate,
      projectionRegistry,
      false,
    );
    unsafeRawRunners.add(bound);
    return bound;
  }

  const tenantDb: TenantDb = {
    tenantId,
    mode,
    global: globalTable,

    unsafeRaw: () => grantedUnsafeRawRunner("own-scope"),
    unsafeRawAllTenants: () => grantedUnsafeRawRunner("all-tenants"),

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
        personalDataDenied(table, [
          ...Object.keys(values),
          ...Object.keys(options.update ?? {}),
          ...Object.keys(options.increment ?? {}),
        ]);
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
      const tenantMoveDenied = tenantIdInSetDenied(table, set);
      if (tenantMoveDenied) return Promise.reject(tenantMoveDenied);
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

  declaredUnsafeRawRunners.set(tenantDb, (reason) => grantedUnsafeRawRunner("all-tenants", reason));
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
  // A tenant-mode source may only be rescoped to its own tenant; anything else would widen, not narrow.
  tenantScopeRebinders.set(tenantDb, (targetTenantId) => {
    if (mode === "tenant" && targetTenantId !== tenantId) {
      throw new AccessDeniedError({
        message: `scopeTenantDbToTenant(): a tenant-mode handle for "${tenantId}" cannot be moved to tenant "${targetTenantId}"`,
      });
    }
    const {
      unsafeRaw: _unsafeRaw,
      globalWrites: _globalWrites,
      ...tenantScopedGrants
    }: TenantDbGrants = scopedGrants ?? {};
    return createTenantDb({
      db,
      tenantId: targetTenantId,
      mode: "tenant",
      tracer,
      meter,
      signal,
      grants: tenantScopedGrants,
    });
  });
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
