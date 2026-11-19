import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import type {
  EscapeHatchDeclaration,
  EscapeHatchReporter,
  EscapeHatchTarget,
} from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb, UncheckedSystemDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import { assertReason } from "../engine/escape-hatch-reason.ts";
import type { EntityDefinition } from "../engine/types/fields.ts";
import type { TenantId } from "../engine/types/identifiers.ts";
import type { Registry } from "../engine/types/index.ts";
import { InternalError } from "../errors/index.ts";
import { type DbRunner, shareUnboundedSiblingPool } from "./connection.ts";
import {
  hasExecutorManagedWriteCapability,
  registerExecutorManagedWriteRunner,
} from "./executor-managed-tables.ts";
import { bindProjectionRegistry, projectionRegistryOf } from "./projection-registry-binding.ts";
import { unscopedRunnerOf } from "./row-level-security-scope.ts";
import { registerRunnerProxyTarget } from "./transaction-serialization.ts";

export const declaredUnsafeRawRunners = new WeakMap<
  TenantDb | UncheckedSystemDb,
  (declaredStepReason?: string) => DbRunner
>();

// The CRUD executor writes through tenantDbRunner, not insertOne, so it asks the
// TenantDb it was handed for its gate. Bound inside createTenantDb so rebound instances
// (withUnsafeRawGrant, acknowledgeConventionCrossTenant) carry it too.
export const personalDataGates = new WeakMap<TenantDb, PersonalDataGate>();

// Lets createTenantDb(ctx.db.unsafeRaw(), ...) inherit the gate. The gate tag sits only on
// per-grant proxies; the registry may additionally sit on the app connection (bindAppProjectionRegistry)
// because there is exactly one per app.
export const runnerPersonalDataGates = new WeakMap<DbRunner, PersonalDataGate>();

// The public createTenantDb refuses these; every tx, savepoint and reserved connection derived
// from an unsafeRaw runner carries the mark, so a callback cannot re-tenant one either.
const unsafeRawRunners = new WeakSet<object>();

export function isUnsafeRawRunner(runner: unknown): boolean {
  return (
    (typeof runner === "object" || typeof runner === "function") &&
    runner !== null &&
    unsafeRawRunners.has(runner)
  );
}

export function boundRunner<TRunner extends DbRunner>(
  runner: TRunner,
  gate: PersonalDataGate | undefined,
  projectionRegistry: Registry | undefined,
  executorManagedWrites: boolean,
  unsafeRaw = false,
): TRunner {
  if (!gate && !projectionRegistry && !executorManagedWrites && !unsafeRaw) return runner;
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
          return boundRunner(reserved, gate, projectionRegistry, executorManagedWrites, unsafeRaw);
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
                boundRunner(txRunner, gate, projectionRegistry, executorManagedWrites, unsafeRaw),
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
  if (unsafeRaw) unsafeRawRunners.add(proxy);
  if (gate) runnerPersonalDataGates.set(proxy, gate);
  if (projectionRegistry) bindProjectionRegistry(proxy, projectionRegistry);
  if (executorManagedWrites) {
    registerExecutorManagedWriteRunner(proxy);
    capableRunnerInners.set(proxy, runner);
  }
  return proxy;
}

// Bound once at boot: every runner, tx, savepoint and reserved connection derived from the
// connection carries the app registry, so executor writes through any TenantDb built on it
// run the custom projections. One registry per connection; a second one is a wiring bug.
export function bindAppProjectionRegistry<TConnection extends DbRunner>(
  connection: TConnection,
  registry: Registry,
): TConnection {
  const bound = projectionRegistryOf(connection);
  if (bound === registry) return connection;
  if (bound !== undefined) {
    throw new InternalError({
      message: "bindAppProjectionRegistry: connection is already bound to another registry",
    });
  }
  const boundConnection = boundRunner(connection, undefined, registry, false);
  shareUnboundedSiblingPool(connection, boundConnection);
  return boundConnection;
}

// A row-level-security scope proxy over the tagged connection is not tagged itself.
export function appProjectionRegistryOf(runner: object): Registry | undefined {
  return projectionRegistryOf(runner) ?? projectionRegistryOf(unscopedRunnerOf(runner));
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
    appProjectionRegistryOf(runner),
    true,
    isUnsafeRawRunner(runner),
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

// A grant is only real when its reason is non-empty — `{ reason: "" }` must not silently unlock it.
export function hasGrant(decl: EscapeHatchDeclaration | undefined): boolean {
  return decl !== undefined && decl.reason.trim().length > 0;
}

// Grants for TenantDb's two escape hatches: db.global()'s write methods
// (write-handler-only) and ctx.db.unsafeRaw() (handler or hook, re-granted per hook).
export type TenantDbGrants = {
  readonly globalWrites?: EscapeHatchDeclaration;
  readonly unsafeRaw?: EscapeHatchDeclaration;
  readonly report?: EscapeHatchReporter;
  // Set for a resolved member principal (ctx.dispatch.queryAsMember): no raw DbRunner leaves
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

export const unsafeRawRebinders = new WeakMap<
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

export const crossTenantRebinders = new WeakMap<
  TenantDb,
  (reason: string, deferReport: boolean) => TenantDb
>();
export const crossTenantUseReporters = new WeakMap<
  TenantDb,
  (target?: EscapeHatchTarget) => void
>();

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

export const tenantScopeRebinders = new WeakMap<TenantDb, (targetTenantId: TenantId) => TenantDb>();

// Tenant-mode handle for one tenant on the same runner/transaction. Keeps report, projection
// registry, personal-data gate, member read-only and write denial; drops unsafeRaw and global
// writes, so callbacks handed this db cannot leave the tenant filter.
export function scopeTenantDbToTenant(db: TenantDb, tenantId: TenantId): TenantDb {
  const rebind = tenantScopeRebinders.get(db);
  if (!rebind) {
    throw new InternalError({
      message:
        "scopeTenantDbToTenant received a TenantDb not built by createTenantDb — no tenant-scope rebinder bound.",
    });
  }
  return rebind(tenantId);
}
