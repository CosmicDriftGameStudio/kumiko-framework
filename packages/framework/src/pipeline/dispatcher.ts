import { type AnyColumn, eq } from "drizzle-orm";
import { requestContext } from "../api/request-context";
import type { DbConnection, DbRow, DbTx } from "../db/connection";
import { buildDrizzleTable } from "../db/table-builder";
import { createTenantDb } from "../db/tenant-db";
import { hasAccess } from "../engine/access";
import { checkWriteFieldRoles, filterReadFields } from "../engine/field-access";
import { parseQn, qn } from "../engine/qualified-name";
import { defineTransitions, guardTransition } from "../engine/state-machine";
import type { EffectiveFeaturesResolver } from "../engine/tier-resolver-extension";
import type {
  AggregateStreamHandle,
  AppContext,
  AppendEventArgs,
  AppendEventFn,
  AuthClaimsContext,
  DeleteContext,
  FetchForWritingArgs,
  HandlerContext,
  HandlerRef,
  JobRunnerRef,
  LifecycleResult,
  Registry,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { HookPhases } from "../engine/types";
import type { TenantId } from "../engine/types/identifiers";

// Re-export for callers that reach for dispatcher-adjacent types (tests,
// HTTP-layer stubs) — dispatch consumes these, grouping the type-surface
// here keeps imports single-source.
export type { WriteResult } from "../engine/types";

import { runValidation } from "../engine/validation";
import {
  AccessDeniedError,
  FeatureDisabledError,
  FrameworkReasons,
  InternalError,
  isKumikoError,
  type KumikoError,
  NotFoundError,
  reraiseAsKumikoError,
  toWriteErrorInfo,
  ValidationError,
  VersionConflictError,
  validationErrorFromZod,
  type WriteErrorInfo,
  writeFailure,
} from "../errors";
import {
  archiveStream as archiveStreamHelper,
  isStreamArchived,
  restoreStream as restoreStreamHelper,
} from "../event-store/archive";
import {
  getStreamVersion,
  loadAggregate,
  loadAggregateAsOf,
  type StoredEvent,
} from "../event-store/event-store";
import {
  type LoadAggregateWithSnapshotResult,
  loadAggregateWithSnapshot,
  type SnapshotReducer,
  saveSnapshot,
} from "../event-store/snapshot";
import { upcastStoredEvent, upcastStoredEvents } from "../event-store/upcaster";
import {
  createMetricsHandle,
  createNoopMetricsHandle,
  emitDispatcherError,
  emitDispatcherHandler,
  getFallbackMeter,
  getFallbackTracer,
  registerStandardMetrics,
} from "../observability";
import { buildBucketKey } from "../rate-limit";
import { assertNoSecretLeak } from "../secrets";
import { createTzContext } from "../time";
import { parseJsonSafe } from "../utils/safe-json";
import { appendDomainEventCore } from "./append-event-core";
import { resolveAuthClaims as runAuthClaimsResolver } from "./auth-claims-resolver";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";
import { runProjections } from "./projections-runner";

type FailedWriteResult = Extract<WriteResult, { isSuccess: false }>;

// Write handlers report failure via `WriteResult.isSuccess === false`. Query
// handlers return arbitrary shapes, so `result` is typed as `unknown` here.
function isFailedWriteResult(result: unknown): result is FailedWriteResult {
  return (
    !!result && typeof result === "object" && "isSuccess" in result && result.isSuccess === false
  );
}

// Handler result is a lifecycle payload when it's an object carrying `kind`
// (save/delete). Query handlers return arbitrary shapes that don't match.
function isLifecycleResult(data: unknown): data is LifecycleResult {
  return !!data && typeof data === "object" && "kind" in data;
}

// Shape-check for write-handler returns. The compile-time type already
// requires WriteResult, but the inline form (r.writeHandler(name, schema,
// fn, opts)) sometimes lets a wrong shape through structural widening —
// the runtime guard below turns the obscure crash that follows into a
// clear, actionable error message.
function isWriteResultShape(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    "isSuccess" in result &&
    typeof result.isSuccess === "boolean"
  );
}

// Compact, log-safe shape description for the shape-guard error message.
// We don't dump JSON of arbitrary user data — just the keys + type so the
// developer can spot the missing isSuccess at a glance.
function describeShape(result: unknown): string {
  if (result === null) return "null";
  if (result === undefined) return "undefined";
  if (typeof result !== "object") return typeof result;
  return `object with keys [${Object.keys(result).slice(0, 6).join(", ")}]`;
}

// Standard span attributes for a dispatcher call. Feature may be undefined
// for internal handlers that weren't registered via defineFeature.
function dispatcherSpanAttributes(
  type: string,
  operation: "query" | "write",
  user: SessionUser,
  feature: string | undefined,
) {
  const attrs: Record<string, string | number | boolean> = {
    "kumiko.handler": type,
    "kumiko.operation": operation,
    "kumiko.user_id": user.id,
    "kumiko.tenant_id": user.tenantId,
  };
  if (feature) attrs["kumiko.feature"] = feature;
  return attrs;
}

// Deferred afterCommit callback — collected during transaction execution,
// fired sequentially once the transaction commits successfully.
type AfterCommitHook = () => Promise<void>;

// Specification for one nested-write expansion. The parent write's payload
// carries items under `key`; each is dispatched as a separate write against
// `subType`, with the foreign-key column `foreignKey` bound to the parent's
// new id. Built by extractNestedSpecs from the parent payload + registry
// relations. See executeNestedWrite for orchestration.
type NestedSpec = {
  readonly key: string;
  readonly subType: string;
  readonly foreignKey: string;
  readonly items: readonly unknown[];
};

// Field-level issue collected by extractNestedSpecs and surfaced as a
// ValidationError by the caller. Shape matches ValidationFieldIssue so we
// can hand it directly to `new ValidationError({ fields })`.
type NestedTypeIssue = {
  readonly path: string;
  readonly code: string;
  readonly i18nKey: string;
};

// Separates a parent payload into a "clean" shape (without nested-relation
// keys) plus the list of expansion specs. Returns null when the payload has
// no nested relations to expand — callers short-circuit to the regular write
// path without paying the overhead of nested orchestration.
//
// Expansion only applies to `:create` handlers (v1). For `:update` / `:delete`
// we return null so the parent write runs unchanged. When a future iteration
// adds update/delete-nested, this is the single point to extend.
//
// Sub-writes run through regular executeWrite, NOT recursively through
// executeNestedWrite — deeper nesting (`tasks[0].subtasks`) is out of scope
// for v1. Those keys reach the sub-handler's zod schema and are silently
// stripped by default zod semantics. Documented limitation; a sub-handler
// that wants to reject depth-2 payloads can use `.strict()` on its schema.
function extractNestedSpecs(
  parentType: string,
  payload: unknown,
  registry: Registry,
): {
  cleanPayload: Record<string, unknown>;
  specs: readonly NestedSpec[];
  typeIssues: readonly NestedTypeIssue[];
} | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  let parsed: ReturnType<typeof parseQn>;
  try {
    parsed = parseQn(parentType);
  } catch {
    return null;
  }
  // v1 scope: only create. Update/delete-nested are explicit future work —
  // they'd need different sub-types and id-handling semantics.
  if (!parsed.name.endsWith(":create")) return null;

  const entityName = registry.getHandlerEntity(parentType);
  if (!entityName) return null;

  const relations = registry.getRelations(entityName);
  const source = payload as Record<string, unknown>; // @cast-boundary engine-payload — generic dispatch über alle Entity-Types
  const clean: Record<string, unknown> = { ...source };
  const specs: NestedSpec[] = [];
  const typeIssues: NestedTypeIssue[] = [];

  for (const [relKey, rel] of Object.entries(relations)) {
    if (rel.type !== "hasMany" || !rel.nestedWrite) continue;
    if (!(relKey in source)) continue;
    const value = source[relKey];

    // Non-array under a nested-write key is a client shape error. Silent
    // strip (via default zod stripping) would hide it — a client sending
    // `tasks: "bogus"` or `tasks: null` has to know the field was ignored,
    // or they'll wonder why their data never showed up. Fail loud.
    if (!Array.isArray(value)) {
      typeIssues.push({
        path: relKey,
        code: "invalid_type",
        i18nKey: "errors.validation.invalid_type",
      });
      // Still strip from clean payload — we're not letting the parent handler
      // see a malformed value either.
      delete clean[relKey];
      continue;
    }

    // Strip the relation key from the clean payload — the parent handler
    // only sees columns it actually owns.
    delete clean[relKey];

    // Sub-type composition: derive scope + operation from the parent qn,
    // swap the entity segment. "feat:write:project:create" → "feat:write:task:create".
    // Assumes target entity has a `:create` handler in the SAME feature scope
    // as the parent. Cross-feature nested-writes are out of scope for v1;
    // when needed, the registry would have to carry a back-pointer from
    // entity → defining feature.
    const subType = qn(parsed.scope, parsed.type, `${rel.target}:create`);

    specs.push({
      key: relKey,
      subType,
      foreignKey: rel.foreignKey,
      items: value,
    });
  }

  if (specs.length === 0 && typeIssues.length === 0) return null;
  return { cleanPayload: clean, specs, typeIssues };
}

// Prefix ValidationError paths so a failure on a nested sub-write maps back
// to the client-visible field path. Example: sub-write fails on `title` with
// path="title"; this prefixes to "tasks.2.title" so the form-controller in
// the UI can highlight the right sub-line's field.
//
// Non-validation errors pass through unchanged — they carry no field paths.
function prefixValidationPath(info: WriteErrorInfo, prefix: string): WriteErrorInfo {
  if (info.code !== "validation_error") return info;
  const details = info.details as
    | {
        fields?: readonly {
          path: string;
          code: string;
          i18nKey: string;
          params?: Readonly<Record<string, unknown>>;
        }[];
      }
    | undefined;
  const fields = details?.fields;
  if (!fields) return info;
  return {
    ...info,
    details: {
      ...details,
      fields: fields.map((f) => ({ ...f, path: `${prefix}.${f.path}` })),
    },
  };
}

// Sentinel thrown inside a Drizzle transaction to force a rollback while
// carrying the command failure context back out. Drizzle rolls back iff the
// transaction callback throws — this class lets us distinguish an expected
// rollback (command returned isSuccess: false) from an unexpected error.
class BatchRollback extends Error {
  constructor(
    readonly failedIndex: number,
    readonly failureError: WriteErrorInfo,
  ) {
    super(`batch rollback at command ${failedIndex}: ${failureError.code}`);
    this.name = "BatchRollback";
  }
}

export type BatchCommand = {
  readonly type: string;
  readonly payload: unknown;
};

export type BatchResult =
  | { readonly isSuccess: true; readonly results: readonly WriteResult[] }
  | {
      readonly isSuccess: false;
      readonly error: WriteErrorInfo;
      readonly failedIndex: number;
      readonly results: readonly WriteResult[];
    };

export type DispatcherOptions = {
  idempotency?: IdempotencyGuard;
  lifecycle?: LifecycleHooks;
  jobRunner?: JobRunnerRef;
  // Resolves the effective-feature set per tenant — the dispatcher uses
  // it to gate calls to handlers of disabled features (403 feature_disabled)
  // and to populate ctx.hasFeature. Absent = all features treated as
  // always-on (no feature-toggles or tier-engine feature loaded). The
  // resolver must be fast and synchronous per call; implementations cache
  // tenant-keyed sets and refresh on tier-assignment / toggle events.
  //
  // **System-context convention:** when called with SYSTEM_TENANT_ID, the
  // resolver should return the union/superset of all tier-features. Two
  // contexts call with this sentinel:
  //   1. event-dispatcher async-pass (consumers tagged with feature X
  //      should not silently skip events from a tenant where X is off —
  //      events are immutable, async work runs through).
  //   2. operator-tooling queries (e.g. feature-toggles:registered) where
  //      a SystemAdmin needs to see platform-truth, not their own
  //      tier-cut.
  // Returning a non-superset for SYSTEM_TENANT_ID will cause silent
  // event-skips and a confusing operator-UI — the framework cannot
  // enforce this contract, but the recipe-test pins the convention.
  effectiveFeatures?: EffectiveFeaturesResolver;
};

type HandlerType = string | HandlerRef;

function resolveType(type: HandlerType): string {
  return typeof type === "string" ? type : type.name;
}

export type Dispatcher = {
  write(
    type: HandlerType,
    payload: unknown,
    user: SessionUser,
    requestId?: string,
  ): Promise<WriteResult>;
  query(type: HandlerType, payload: unknown, user: SessionUser): Promise<unknown>;
  command(type: HandlerType, payload: unknown, user: SessionUser): Promise<void>;
  // Atomic multi-command write: all commands run in a single DB transaction.
  // On any failure, the transaction rolls back and afterCommit hooks do NOT fire.
  // On success, afterCommit hooks of every command are fired sequentially after commit.
  //
  // requestId enables idempotent retries (for the Savable-Dispatcher): a repeated
  // batch with the same requestId returns the cached result without re-executing.
  batch(
    commands: readonly BatchCommand[],
    user: SessionUser,
    requestId?: string,
  ): Promise<BatchResult>;
  // Run every registered r.authClaims() hook against `user` and merge their
  // returns under the "<featureName>:<key>" auto-prefix. Used at login and
  // switch-tenant to populate SessionUser.claims before signing the JWT.
  // This is the single resolve implementation — ctx.resolveAuthClaims is a
  // thin pass-through so both entry points can't drift.
  resolveAuthClaims(user: SessionUser): Promise<Record<string, unknown>>;
};

export function createDispatcher(
  registry: Registry,
  context: AppContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, lifecycle, jobRunner, effectiveFeatures } = options;

  // Pre-build tables and transition maps for auto-guard (avoid per-request allocation)
  const tableCache = new Map<string, ReturnType<typeof buildDrizzleTable>>();
  const transitionCache = new Map<string, ReturnType<typeof defineTransitions>>();

  function getTable(entityName: string): ReturnType<typeof buildDrizzleTable> | undefined {
    if (tableCache.has(entityName)) return tableCache.get(entityName);
    const entity = registry.getEntity(entityName);
    if (!entity) return undefined;
    const table = buildDrizzleTable(entityName, entity, {
      relations: registry.getRelations(entityName),
    });
    tableCache.set(entityName, table);
    return table;
  }

  function getTransitions(args: {
    entityName: string;
    fieldName: string;
    map: Record<string, readonly string[]>;
  }): ReturnType<typeof defineTransitions> {
    // Scope by entity — `fieldName` alone collides across entities (e.g. both
    // `invoice.status` and `driverOrder.status` exist with different maps),
    // which would apply the wrong transition rules to whichever entity arrives
    // second.
    const key = `${args.entityName}:${args.fieldName}`;
    const cached = transitionCache.get(key);
    if (cached) return cached;
    const transitions = defineTransitions(args.map);
    transitionCache.set(key, transitions);
    return transitions;
  }

  // ctx.appendEvent — append a domain event onto a specific aggregate stream
  // in the current tx, then fire matching inline projections. Core logic
  // lives in appendDomainEventCore; this wrapper just locates dbSource +
  // stringifies the SessionUser id for the shared helper.
  async function appendDomainEvent(
    args: AppendEventArgs,
    user: SessionUser,
    tx: DbTx | undefined,
    callerFeature: string | undefined,
  ): Promise<void> {
    const dbSource: DbConnection | DbTx | undefined =
      tx ?? (context.db as DbConnection | undefined);
    if (!dbSource) {
      throw new InternalError({
        message: `ctx.appendEvent("${args.type}") requires a database connection — none is configured.`,
      });
    }
    await appendDomainEventCore(
      {
        registry,
        db: dbSource,
        tenantId: user.tenantId,
        userId: String(user.id),
        callSiteLabel: "ctx.appendEvent",
        callerFeature,
      },
      args,
    );
  }

  function buildHandlerContext(
    type: string,
    user: SessionUser,
    tx?: DbTx,
    afterCommitHooks?: AfterCommitHook[],
  ): HandlerContext {
    const isSystem = registry.isHandlerSystemScoped(type);
    // The outer dispatcher receives a DbConnection from the server/stack;
    // AppContext's `db` union also allows TenantDb (for downstream hook calls),
    // but at this point we're the root of the pipeline — cast is safe.
    const dbSource: DbConnection | DbTx | undefined =
      tx ?? (context.db as DbConnection | undefined);
    const reqCtx = requestContext.get();
    const db = dbSource
      ? createTenantDb(
          dbSource,
          user.tenantId,
          isSystem ? "system" : "tenant",
          context.tracer,
          context.meter,
          // Propagate the request's AbortSignal so every TenantDb query
          // throws when the client has disconnected — handlers with many
          // sequential queries skip the rest of the chain instead of
          // burning DB-CPU for results no one reads.
          reqCtx?.signal,
        )
      : undefined;
    const log = context.log?.child({
      handler: type,
      tenantId: user.tenantId,
      userId: user.id,
      ...(reqCtx && { requestId: reqCtx.requestId }),
    });
    const notify = context._notifyFactory ? context._notifyFactory(user, user.tenantId) : undefined;
    // Mirror notify: only built when the config feature wired its factory.
    const config =
      context._configAccessorFactory && db
        ? context._configAccessorFactory({ user: { id: user.id, tenantId: user.tenantId }, db })
        : undefined;

    // Observability — feature-bound metrics handle, so ctx.metrics.inc("foo")
    // resolves to kumiko_<feature>_foo. Unknown feature falls back to noop
    // so legacy internal handlers don't crash.
    const tracer = context.tracer ?? getFallbackTracer();
    const meter = context.meter;
    const featureName = registry.getHandlerFeature(type);
    const metrics =
      meter && featureName ? createMetricsHandle(meter, featureName) : createNoopMetricsHandle();

    // Cross-feature bridge. Queries and writes invoked through ctx.* share:
    //   - the current transaction (tx) — nested writes roll back with the parent
    //   - the current afterCommitHooks sink — deferred side-effects fire once
    //     when the outermost transaction commits
    // `queryAs` / `writeAs` let a handler explicitly switch identity
    // (e.g. system-privileged lookups that bypass field-access read filters).
    const bridgeSink = afterCommitHooks ?? [];
    const bridge = {
      query: (targetType: string, payload: unknown) => executeQuery(targetType, payload, user, tx),
      queryAs: (asUser: SessionUser, targetType: string, payload: unknown) =>
        executeQuery(targetType, payload, asUser, tx),
      write: async (targetType: string, payload: unknown) => {
        const res = await executeWrite(targetType, payload, user, tx, bridgeSink);
        return res;
      },
      writeAs: async (asUser: SessionUser, targetType: string, payload: unknown) => {
        const res = await executeWrite(targetType, payload, asUser, tx, bridgeSink);
        return res;
      },
      // Strict + unsafe share the same runtime — only the type-surface
      // differs. The strict signature is what's exposed to typed callers;
      // unsafe is the explicit escape-hatch for runtime-pluggable events.
      // @cast-boundary engine-bridge — concrete impl conforms to AppendEventFn overload
      appendEvent: (async (args: AppendEventArgs) => {
        await appendDomainEvent(args, user, tx, registry.getHandlerFeature(type));
      }) as AppendEventFn,
      appendEventUnsafe: async (args: AppendEventArgs) => {
        await appendDomainEvent(args, user, tx, registry.getHandlerFeature(type));
      },
      fetchForWriting: async (args: FetchForWritingArgs): Promise<AggregateStreamHandle> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.fetchForWriting("${args.aggregateId}") requires a database connection — none is configured.`,
          });
        }
        // Stream-version authoritative (same policy as CRUD executor + Block 0).
        // A single SELECT MAX(version) is cheaper than loading the full stream
        // when the caller just wants to append — but most callers also want
        // the events (business-rule checks), so fetch both in parallel.
        const [storedEvents, fetchedVersion] = await Promise.all([
          loadAggregate(dbSource, args.aggregateId, user.tenantId),
          getStreamVersion(dbSource, args.aggregateId, user.tenantId),
        ]);
        const events = await upcastStoredEvents(storedEvents, registry.getEventUpcasters(), {
          db: dbSource,
          tenantId: user.tenantId,
        });

        // Optimistic concurrency: if the caller knows the version they
        // worked against (e.g. from a prior read-model row) and the stream
        // has moved on, fail fast before any downstream work.
        if (args.expectedVersion !== undefined && args.expectedVersion !== fetchedVersion) {
          throw new VersionConflictError({
            entityId: args.aggregateId,
            expectedVersion: args.expectedVersion,
            currentVersion: fetchedVersion,
          });
        }

        // Handle's internal version bumps on every appendOne so multiple
        // appends in a row stay in order without re-reading the DB.
        let handleVersion = fetchedVersion;
        const appendOne = async (appendArgs: {
          readonly type: string;
          readonly payload: unknown;
        }): Promise<void> => {
          await appendDomainEvent(
            {
              aggregateId: args.aggregateId,
              aggregateType: args.aggregateType,
              type: appendArgs.type,
              payload: appendArgs.payload,
            },
            user,
            tx,
            registry.getHandlerFeature(type),
          );
          handleVersion += 1;
        };

        return {
          events,
          get version() {
            return handleVersion;
          },
          appendOne,
        };
      },
      loadAggregate: async (
        aggregateId: string,
        loadOptions?: { readonly asOf?: Temporal.Instant },
      ): Promise<readonly StoredEvent[]> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.loadAggregate("${aggregateId}") requires a database connection — none is configured.`,
          });
        }
        const events = loadOptions?.asOf
          ? await loadAggregateAsOf(dbSource, aggregateId, user.tenantId, loadOptions.asOf)
          : await loadAggregate(dbSource, aggregateId, user.tenantId);
        return upcastStoredEvents(events, registry.getEventUpcasters(), {
          db: dbSource,
          tenantId: user.tenantId,
        });
      },
      archiveStream: async (
        aggregateId: string,
        archiveArgs: { readonly aggregateType: string; readonly reason?: string },
      ): Promise<void> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.archiveStream("${aggregateId}") requires a database connection — none is configured.`,
          });
        }
        await archiveStreamHelper(dbSource, {
          tenantId: user.tenantId,
          aggregateId,
          aggregateType: archiveArgs.aggregateType,
          archivedBy: user.id,
          reason: archiveArgs.reason,
        });
      },
      restoreStream: async (aggregateId: string): Promise<void> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.restoreStream("${aggregateId}") requires a database connection — none is configured.`,
          });
        }
        await restoreStreamHelper(dbSource, user.tenantId, aggregateId);
      },
      isStreamArchived: async (aggregateId: string): Promise<boolean> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.isStreamArchived("${aggregateId}") requires a database connection — none is configured.`,
          });
        }
        return isStreamArchived(dbSource, user.tenantId, aggregateId);
      },
      snapshotAggregate: async (snapshotArgs: {
        readonly aggregateId: string;
        readonly aggregateType: string;
        readonly version: number;
        readonly state: Record<string, unknown>;
      }): Promise<void> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.snapshotAggregate("${snapshotArgs.aggregateId}") requires a database connection — none is configured.`,
          });
        }
        await saveSnapshot(dbSource, {
          aggregateId: snapshotArgs.aggregateId,
          tenantId: user.tenantId,
          aggregateType: snapshotArgs.aggregateType,
          version: snapshotArgs.version,
          state: snapshotArgs.state,
        });
      },
      loadAggregateWithSnapshot: async <TState extends Record<string, unknown>>(
        aggregateId: string,
        reducer: SnapshotReducer<TState>,
        initial: TState,
      ): Promise<LoadAggregateWithSnapshotResult<TState>> => {
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.loadAggregateWithSnapshot("${aggregateId}") requires a database connection — none is configured.`,
          });
        }
        // Upcaster-aware: pass an upcastEvent callback so loadAggregateWithSnapshot
        // walks every delta through the registered chain before invoking the
        // user's (sync) reducer. Async upcasters (DB-enrichment) are awaited
        // inside loadAggregateWithSnapshot — feature authors never see legacy
        // payload shapes regardless of which load path they chose.
        const upcasters = registry.getEventUpcasters();
        const upcastCtx = { db: dbSource, tenantId: user.tenantId };
        return loadAggregateWithSnapshot<TState>(
          dbSource,
          aggregateId,
          user.tenantId,
          reducer,
          initial,
          { upcastEvent: (event) => upcastStoredEvent(event, upcasters, upcastCtx) },
        );
      },
      queryProjection: async <T = Record<string, unknown>>(
        qualifiedName: string,
        queryOptions?: { readonly allTenants?: boolean },
      ): Promise<readonly T[]> => {
        // queryProjection works against both single-stream and multi-stream
        // projections. MSPs without a table cannot be queried — those are
        // side-effect-only consumers (no state to read back).
        const singleProj = registry.getAllProjections().get(qualifiedName);
        const mspProj = registry.getAllMultiStreamProjections().get(qualifiedName);
        const projTable = singleProj?.table ?? mspProj?.table;
        if (!projTable) {
          const singleNames = [...registry.getAllProjections().keys()];
          const mspNames = [...registry.getAllMultiStreamProjections().keys()].filter(
            (n) => registry.getAllMultiStreamProjections().get(n)?.table,
          );
          const all = [...singleNames, ...mspNames];
          throw new InternalError({
            message:
              `ctx.queryProjection("${qualifiedName}") — projection not registered, or it is a ` +
              `table-less MSP (side-effect-only). Known queryable projections: ${all.join(", ") || "(none)"}`,
          });
        }
        const dbSource: DbConnection | DbTx | undefined =
          tx ?? (context.db as DbConnection | undefined);
        if (!dbSource) {
          throw new InternalError({
            message: `ctx.queryProjection("${qualifiedName}") requires a database connection — none is configured.`,
          });
        }
        // Introspect for a tenant_id column on the projection table. Auto-
        // filter keeps cross-tenant leaks out unless the handler explicitly
        // opts in. Works with any drizzle-table whose tenant column is named
        // tenantId on the JS side.
        // @cast-boundary dynamic-key — drizzle's PgTable columns are schema-dependent
        const tenantCol = (projTable as Record<string, AnyColumn | undefined>)["tenantId"];
        let rows: readonly Record<string, unknown>[];
        if (tenantCol && !queryOptions?.allTenants) {
          rows = (await dbSource
            .select()
            .from(projTable)
            .where(eq(tenantCol, user.tenantId))) as readonly Record<string, unknown>[]; // @cast-boundary db-row
        } else {
          rows = (await dbSource.select().from(projTable)) as readonly Record<string, unknown>[]; // @cast-boundary db-row
        }
        return rows as readonly T[]; // @cast-boundary engine-payload
      },
      // Thin pass-through: one resolve impl lives on the dispatcher, the
      // handler surface just forwards the call so both entry points (login
      // handler via ctx.resolveAuthClaims, switch-tenant route via
      // dispatcher.resolveAuthClaims) cannot drift.
      resolveAuthClaims: (claimsUser: SessionUser) => resolveAuthClaimsFn(claimsUser),

      // Feature-effective check for in-handler opt-in logic. Scope:
      // **current user's tenant** — for cross-tenant lookups (rare,
      // SysAdmin operations) read effectiveFeatures(otherTenantId) directly.
      // When the feature-toggles or tier-engine feature isn't wired (no
      // effectiveFeatures callback), always returns true — apps without
      // tier-cuts treat all features on.
      hasFeature: (featureName: string): boolean =>
        effectiveFeatures ? effectiveFeatures(user.tenantId).has(featureName) : true,
    };

    // Registry is always the dispatcher's registry — injecting it here lets
    // tests/callers pass `context` without `registry` and still get a valid
    // HandlerContext. The spread-then-assign order matters: anything in
    // `context` can be overridden, but we want the authoritative registry
    // from the dispatcher's own closure to win.
    // ctx.tz ist immer da. Tenant + User-Defaults kommen aus dem
    // SessionUser sobald die Felder existieren — bis dahin "UTC".
    // TODO(Iteration 6): tenant.timezone + user.timezone aus session/db lesen.
    const tz = createTzContext();

    return {
      ...context,
      registry,
      db,
      log,
      notify,
      ...(config && { config }),
      tracer,
      metrics,
      tz,
      // Cancellation signal flows from the HTTP middleware via
      // requestContext. Conditional spread so non-HTTP entry-points
      // (jobs, dispatcher MSP-applies) don't get a phantom signal that
      // would always read aborted=false but feel meaningful.
      ...(reqCtx?.signal ? { signal: reqCtx.signal } : {}),
      // Propagate the feature-toggle resolver so the lifecycle pipeline,
      // MSP runner, and ctx.hasFeature all pull from the same source.
      ...(effectiveFeatures && { effectiveFeatures }),
      // ctx.user als Convenience-Alias auf event.user. Der typisch-
      // intuitive Pfad „der Context kennt seinen User" — ohne den
      // schreiben Handler `event.user.tenantId` und brechen sich die
      // Finger an typo-resistenten ctx.user-Patterns. Identisch zum
      // event.user-Wert; Identity-Switches nutzen weiterhin queryAs/writeAs.
      user,
      _userId: user.id,
      _tenantId: user.tenantId,
      _handlerType: type,
      ...bridge,
    } as HandlerContext;
  }

  const dispatcherTracer = context.tracer ?? getFallbackTracer();
  const dispatcherMeter = context.meter ?? getFallbackMeter();
  // Ensure standard metrics exist on whatever meter we ended up with.
  // Idempotent: buildServer may have registered them already.
  registerStandardMetrics(dispatcherMeter);

  // Wrap handler execution in a dispatcher.handler span AND emit the standard
  // dispatcher metrics (duration + error counter). Errors are re-thrown so
  // control flow stays identical to the uninstrumented path.
  //
  // Writes are special-cased: executeWriteInner converts thrown handler errors
  // into a WriteResult with isSuccess=false (rather than letting them bubble).
  // We inspect the result to paint the dispatcher span + error counter on
  // those structural failures too — otherwise "handler threw" would only show
  // up when the caller forgot to use writeFailure().
  async function runHandlerInstrumented<T>(
    type: string,
    operation: "query" | "write",
    user: SessionUser,
    inner: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    // Outcome recorded inside the withSpan callback, emitted in finally so
    // success/failure/throw all hit a single metric-emit path.
    let success = true;
    let errorClass: string | undefined;

    try {
      return await dispatcherTracer.withSpan(
        "kumiko.dispatcher.handler",
        {
          attributes: dispatcherSpanAttributes(
            type,
            operation,
            user,
            registry.getHandlerFeature(type),
          ),
        },
        async (span) => {
          try {
            const result = await inner();
            if (operation === "write" && isFailedWriteResult(result)) {
              success = false;
              errorClass = result.error?.code ?? "UnknownError";
              span.setStatus("error", errorClass);
            }
            return result;
          } catch (error) {
            success = false;
            errorClass = error instanceof Error && error.name ? error.name : "UnknownError";
            throw error;
          }
        },
      );
    } finally {
      if (!success && errorClass) {
        emitDispatcherError(dispatcherMeter, { handler: type, errorClass });
      }
      emitDispatcherHandler(
        dispatcherMeter,
        { handler: type, success },
        (performance.now() - start) / 1000,
      );
    }
  }

  // L3 rate limit gate. Called by both query and write paths before
  // access-check. Reasoning:
  //   - handler without rateLimit → no-op
  //   - app booted without rateLimit resolver → InternalError so the
  //     misconfig surfaces immediately, not on first 429
  //   - bucket builder returns "skip" (e.g. ip-based but no client IP):
  //     pass through. ip-modes are commonly used at L1/L2 middleware
  //     where the IP comes from Hono directly; falling back to "skip"
  //     here keeps non-HTTP entry-points (jobs, MSPs) functional.
  // Feature-toggle gate. Returns the error to fold into a WriteFailure in the
  // write path, or throws for the query path (where throws flow through the
  // same outer instrumentation wrapper as other dispatcher errors).
  //
  // When `effectiveFeatures` is not wired (tests, apps without feature-toggles
  // loaded), every handler is treated as enabled — the gate is a pure
  // pass-through in that common case.
  function checkFeatureEnabled(
    qualifiedHandler: string,
    tenantId: TenantId,
  ): import("../errors").FeatureDisabledError | undefined {
    if (!effectiveFeatures) return undefined;
    const owner = registry.getHandlerFeature(qualifiedHandler);
    // skip: handler without an owning feature cannot be toggled — shouldn't
    // happen for registry-built handlers, but guards against edge-case
    // runtime injections.
    if (!owner) return undefined;
    const set = effectiveFeatures(tenantId);
    if (set.has(owner)) return undefined;
    return new FeatureDisabledError(owner, qualifiedHandler);
  }

  function ensureFeatureEnabled(qualifiedHandler: string, tenantId: TenantId): void {
    const err = checkFeatureEnabled(qualifiedHandler, tenantId);
    if (err) throw err;
  }

  async function enforceRateLimit(
    rateLimit: import("../engine/types").RateLimitOption | undefined,
    handlerName: string,
    user: SessionUser,
  ): Promise<void> {
    // skip: defence-in-depth — both call-sites already gate on
    //       handler.rateLimit !== undefined, so this branch only fires
    //       if a future caller forgets the inline check.
    if (!rateLimit) return;
    if (!context.rateLimit) {
      throw new InternalError({
        message: `Handler "${handlerName}" declares rateLimit but no RateLimitResolver is configured. Load the rateLimiting feature or remove the option.`,
      });
    }
    const reqCtx = requestContext.get();
    const bucket = buildBucketKey(rateLimit, {
      handlerName,
      user,
      ip: reqCtx?.ip,
    });
    // skip: ip-bucketed handler called from a non-HTTP entry point
    //       (job, MSP-apply) — no client IP to bucket on. Pass through;
    //       L1/L2 middleware handle the HTTP-side ip caps.
    if (bucket.kind === "skip") return;
    await context.rateLimit.enforce(bucket.key, {
      limit: rateLimit.limit,
      windowSeconds: rateLimit.windowSeconds,
      cost: rateLimit.cost,
    });
  }

  // Standalone query execution — used by the public dispatcher.query() and
  // by ctx.query/ctx.queryAs inside handlers. Runs the handler, applies
  // field-level read filters for the given user, logs the event.
  async function executeQuery(
    type: string,
    payload: unknown,
    user: SessionUser,
    tx?: DbTx,
  ): Promise<unknown> {
    return runHandlerInstrumented(type, "query", user, () =>
      executeQueryInner(type, payload, user, tx),
    );
  }

  async function executeQueryInner(
    type: string,
    payload: unknown,
    user: SessionUser,
    tx?: DbTx,
  ): Promise<unknown> {
    const handler = registry.getQueryHandler(type);
    if (!handler) throw new NotFoundError("handler", type);

    // Feature-toggle gate runs BEFORE rate-limit on purpose: calls to a
    // disabled feature must not consume the rate-limit quota — the call
    // never happened from the feature's perspective. Order is: lookup →
    // feature-gate → rate-limit → access → validation → handler.
    ensureFeatureEnabled(type, user.tenantId);

    // Rate-limit gate runs BEFORE access-check on purpose: anonymous /
    // unauthorized callers must hit the cap too (otherwise the limit
    // would be a free probe-detector for valid credentials). The
    // resolver throws RateLimitError which the dispatcher's outer
    // wrapper turns into a 429 response. Inline-skip when the handler
    // didn't opt in — keeps the hot path zero-cost (no await on a
    // no-op promise).
    if (handler.rateLimit !== undefined) {
      await enforceRateLimit(handler.rateLimit, type, user);
    }

    // Default-deny: missing access rule is treated as "no one has access".
    // The registry boot-validator refuses to register handlers without one,
    // so in normal boots this branch shouldn't fire — the guard is belt-and-
    // suspenders in case a handler sneaks through (e.g. runtime injection).
    if (!hasAccess(user, handler.access)) {
      throw new AccessDeniedError({
        message: `access denied for ${type}`,
        details: { handler: type },
      });
    }

    const parsed = handler.schema.safeParse(payload);
    if (!parsed.success) {
      throw validationErrorFromZod(parsed.error);
    }

    const handlerContext = buildHandlerContext(type, user, tx);
    let result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

    // Field-level read filter
    const entityName = registry.getHandlerEntity(type);
    if (entityName) {
      const entity = registry.getEntity(entityName);
      if (entity && result && typeof result === "object") {
        if (Array.isArray(result)) {
          result = result.map((row: Record<string, unknown>) =>
            filterReadFields(entity, row, user),
          );
        } else if ("rows" in (result as DbRow)) {
          // @cast-boundary engine-payload — generic handler-result shape narrow
          const r = result as { rows: Record<string, unknown>[]; nextCursor: string | null };
          result = {
            ...r,
            rows: r.rows.map((row) => filterReadFields(entity, row, user)),
          };
        } else {
          result = filterReadFields(entity, result as DbRow, user);
        }
      }
    }

    // Response-guard: fail the request if a handler accidentally included
    // a Secret<> branded value in its return. Must run AFTER field-access
    // filtering so a legitimately stripped secret doesn't false-positive.
    assertNoSecretLeak(result);
    return result;
  }

  // Runs lifecycle hooks for a handler result. inTransaction hooks fire NOW
  // (they see the tx via ctx.db when batch/write opens a transaction).
  // afterCommit hooks are queued into `afterCommitHooks` for the caller to
  // flush after commit.
  async function runLifecycle(
    type: string,
    data: unknown,
    handlerContext: HandlerContext,
    afterCommitHooks: AfterCommitHook[],
  ): Promise<void> {
    if (!lifecycle) {
      handlerContext.log?.debug(`runLifecycle: skipping ${type} — no lifecycle pipeline`);
      return;
    }
    if (!isLifecycleResult(data)) {
      handlerContext.log?.debug(`runLifecycle: skipping ${type} — result is not a lifecycle kind`);
      return;
    }
    const result = data;

    // Projections run FIRST, inside the tx, before any user postSave/postDelete
    // hooks. If a projection apply() throws, the whole tx rolls back — the
    // event and the auto-projection row go with it. Running before the hooks
    // keeps projection state consistent with what the hooks observe.
    await runProjections(result, handlerContext);

    if (result.kind === "save") {
      await lifecycle.runPostSave(type, result, handlerContext, HookPhases.inTransaction);
      afterCommitHooks.push(() =>
        lifecycle.runPostSave(type, result, handlerContext, HookPhases.afterCommit),
      );
    } else if (result.kind === "delete") {
      await lifecycle.runPreDelete(type, result, handlerContext);
      await lifecycle.runPostDelete(type, result, handlerContext, HookPhases.inTransaction);
      afterCommitHooks.push(() =>
        lifecycle.runPostDelete(type, result, handlerContext, HookPhases.afterCommit),
      );
    }
  }

  // Shared write pipeline: validates, executes handler, runs lifecycle + side effects.
  // Used by runBatch (which opens a transaction and flushes afterCommitHooks on commit).
  //
  // Contract:
  //   - `tx` is the active Drizzle transaction handle (or undefined for the no-DB
  //     fallback path used by tests without a Postgres connection).
  //   - `afterCommitHooks` collects deferred side-effects that must only fire
  //     after the transaction commits. The caller flushes them on commit, drops
  //     them on rollback. executeWrite never fires them directly.
  async function executeWrite(
    type: string,
    payload: unknown,
    user: SessionUser,
    tx: DbTx | undefined,
    afterCommitHooks: AfterCommitHook[],
  ): Promise<WriteResult> {
    return runHandlerInstrumented(type, "write", user, () =>
      executeWriteInner(type, payload, user, tx, afterCommitHooks),
    );
  }

  // Nested-write orchestration (v1: depth=1, create-only, hasMany-only).
  //
  // When a parent `:create` handler's payload carries values under keys
  // declared as `hasMany` relations with `nestedWrite: true`, those values
  // are expanded into child writes: parent first (so its new id exists),
  // then each nested entry as a separate `<target>:create` write with the
  // foreign key set by the framework — never taken from the client. All of
  // this runs inside the caller's transaction, so a child failure rolls the
  // parent (and any earlier children) back together.
  //
  // This wrapper is what runBatch calls, not executeWrite. Single writes
  // (`dispatcher.write`) flow through runBatch as batch-of-one, so they get
  // nested-expansion too for free. A batch with N heterogeneous commands
  // can each independently carry nested-children — all still one TX.
  async function executeNestedWrite(
    type: string,
    payload: unknown,
    user: SessionUser,
    tx: DbTx | undefined,
    afterCommitHooks: AfterCommitHook[],
  ): Promise<WriteResult> {
    const nested = extractNestedSpecs(type, payload, registry);
    if (!nested) return executeWrite(type, payload, user, tx, afterCommitHooks);

    // Pre-flight client-shape checks. Merge non-array issues (collected up
    // front by extractNestedSpecs) with fk-injection issues into one error
    // so the client sees every problem in a single round-trip.
    //
    // Security rail: the client MUST NOT supply the foreign key on nested
    // items. The framework binds it from the parent's new id. Silent-overwrite
    // would mask an attempt to attach children to a different parent — fail
    // loud with a ValidationError carrying a client-mappable path.
    const issues: Array<{ path: string; code: string; i18nKey: string }> = [...nested.typeIssues];
    for (const spec of nested.specs) {
      for (let i = 0; i < spec.items.length; i++) {
        const item = spec.items[i];
        if (item && typeof item === "object" && spec.foreignKey in item) {
          issues.push({
            path: `${spec.key}.${i}.${spec.foreignKey}`,
            code: "unexpected_field",
            i18nKey: "errors.validation.unexpected_field",
          });
        }
      }
    }
    if (issues.length > 0) {
      return writeFailure(new ValidationError({ fields: issues }));
    }

    const parentResult = await executeWrite(type, nested.cleanPayload, user, tx, afterCommitHooks);
    if (!parentResult.isSuccess) return parentResult;

    // Handlers built on the CRUD executor return a SaveContext wrapper —
    // `{ kind: "save", id, data: <row>, changes, previous, event, ... }`.
    // The wrapper is load-bearing for batch-level hooks downstream (see
    // flushBatchHooks), so we mutate in place: nested children land on the
    // inner `data` (which mirrors the entity shape the client expects) while
    // the wrapper keeps its SaveContext semantics intact for the lifecycle
    // pipeline. For handlers that return a bare row (no wrapper), children
    // land directly on that object.
    //
    // Hook-ordering note: per-entity postSave hooks already ran inside the
    // parent's executeWrite call above — they never saw `tasks`, which is
    // the right semantic (postSave gets the entity's own columns, not
    // synthetic relation keys). A future postSaveBatch subscriber that
    // enumerates columns generically WOULD see `tasks`; no such subscriber
    // exists today. If you add one that iterates `Object.keys(save.data)`,
    // filter by `entity.fields` membership to stay correct.
    // handler-Result.data ist generic über alle Entity-Handler; nested-
    // write inspiziert die shape strukturell.
    const parentWrapper = parentResult.data as Record<string, unknown>; // @cast-boundary engine-payload
    const parentRow = (parentWrapper["data"] ?? parentWrapper) as Record<string, unknown>; // @cast-boundary engine-payload
    const parentId = parentRow["id"];
    if (typeof parentId !== "string") {
      return writeFailure(
        new InternalError({
          message: `nested-write: parent handler "${type}" returned no string "id" — cannot attach children`,
        }),
      );
    }

    for (const spec of nested.specs) {
      const subRows: Record<string, unknown>[] = [];
      for (let i = 0; i < spec.items.length; i++) {
        const rawItem = spec.items[i];
        const itemObj = (rawItem ?? {}) as Record<string, unknown>; // @cast-boundary engine-payload
        const subPayload = { ...itemObj, [spec.foreignKey]: parentId };
        const subResult = await executeWrite(spec.subType, subPayload, user, tx, afterCommitHooks);
        if (!subResult.isSuccess) {
          return {
            isSuccess: false,
            error: prefixValidationPath(subResult.error, `${spec.key}.${i}`),
          };
        }
        const subWrapper = subResult.data as Record<string, unknown>; // @cast-boundary engine-payload
        const subRow = (subWrapper["data"] ?? subWrapper) as Record<string, unknown>; // @cast-boundary engine-payload
        subRows.push(subRow);
      }
      parentRow[spec.key] = subRows;
    }

    return parentResult;
  }

  async function executeWriteInner(
    type: string,
    payload: unknown,
    user: SessionUser,
    tx: DbTx | undefined,
    afterCommitHooks: AfterCommitHook[],
  ): Promise<WriteResult> {
    const handler = registry.getWriteHandler(type);
    if (!handler) return writeFailure(new NotFoundError("handler", type));

    // Feature-toggle gate: disabled handlers must short-circuit before any
    // rate-limit/access/validation work — see executeQueryInner comment.
    const disabledErr = checkFeatureEnabled(type, user.tenantId);
    if (disabledErr) return writeFailure(disabledErr);

    // Rate-limit gate before access (same reasoning as in executeQueryInner).
    // Throws RateLimitError; the outer wrapper turns it into a 429
    // WriteFailure via toWriteErrorInfo. Inline-skip when no opt-in —
    // hot path stays zero-cost.
    if (handler.rateLimit !== undefined) {
      try {
        await enforceRateLimit(handler.rateLimit, type, user);
      } catch (e) {
        if (isKumikoError(e)) return writeFailure(e);
        throw e;
      }
    }

    // Default-deny: missing access rule is treated as "no one has access".
    // The registry boot-validator refuses to register handlers without one,
    // so in normal boots this branch shouldn't fire — the guard is belt-and-
    // suspenders in case a handler sneaks through (e.g. runtime injection).
    if (!hasAccess(user, handler.access)) {
      return writeFailure(
        new AccessDeniedError({
          message: `access denied for ${type}`,
          details: { handler: type },
        }),
      );
    }

    const parsed = handler.schema.safeParse(payload);
    if (!parsed.success) {
      return writeFailure(validationErrorFromZod(parsed.error));
    }

    const hookErrors = runValidation(registry, type, parsed.data as DbRow);
    if (hookErrors) {
      return writeFailure(
        new ValidationError({
          fields: hookErrors.map((e) => ({
            path: e.field,
            code: e.error,
            i18nKey: `errors.validation.${e.error}`,
          })),
        }),
      );
    }

    // Field-level write access check
    const entityName = registry.getHandlerEntity(type);
    if (entityName) {
      const entity = registry.getEntity(entityName);
      if (entity) {
        const fieldsToCheck = (parsed.data as DbRow)["changes"] as
          | Record<string, unknown>
          | undefined;
        const writePayload = fieldsToCheck ?? (parsed.data as DbRow);
        // Pre-handler check: role-only gate. Ownership-level row-match runs
        // later in the executor where oldRow is loaded — that split lets
        // updates with partial changes still pass the pre-handler check and
        // get their full evaluation at save time.
        const deniedField = checkWriteFieldRoles(entity, writePayload, user);
        if (deniedField) {
          return writeFailure(
            new AccessDeniedError({
              message: `field access denied: ${deniedField}`,
              i18nKey: "errors.access.fieldDenied",
              details: {
                reason: FrameworkReasons.fieldAccessDenied,
                field: deniedField,
                handler: type,
              },
            }),
          );
        }
      }
    }

    const handlerContext = buildHandlerContext(type, user, tx, afterCommitHooks);

    // Auto transition guard: if entity has transitions and handler doesn't skip it
    if (entityName && !handler.skipTransitionGuard) {
      const entity = registry.getEntity(entityName);
      if (entity?.transitions && handlerContext.db) {
        const parsedData = parsed.data as DbRow;
        const changes = (parsedData["changes"] as DbRow) ?? parsedData;
        const id = (parsedData["id"] as number) ?? undefined;

        for (const [fieldName, transitionMap] of Object.entries(entity.transitions)) {
          const newValue = changes[fieldName] as string | undefined;
          if (!newValue || !id) continue;

          const table = getTable(entityName);
          if (!table) continue;

          // SELECT FOR UPDATE inside the surrounding transaction — locks the
          // row so a concurrent handler can't mutate `status` between our
          // guard check and the handler's UPDATE. Without this lock the guard
          // can false-pass; optimistic locking would catch it later, but with
          // a less specific error. Falls back to a plain SELECT if no tx is
          // active (tests without a DB connection).
          const selectQuery = handlerContext.db.select().from(table);
          const filtered = selectQuery.where(eq(table["id"], id));
          const rows = tx ? await filtered.for("update") : await filtered;
          const row = rows[0];

          if (!row) continue;
          // Skip guard for soft-deleted rows — they shouldn't be transitioning
          // at all; a handler that wants to move a deleted row should use
          // skipTransitionGuard or restore first.
          if (entity.softDelete && (row as DbRow)["isDeleted"] === true) {
            continue;
          }
          const currentValue = (row as DbRow)[fieldName] as string;
          guardTransition(
            getTransitions({ entityName, fieldName, map: transitionMap }),
            currentValue,
            newValue,
          );
        }
      }
    }

    // The handler itself plus the lifecycle pipeline run under the same
    // try-wrapper: any KumikoError bubbles up as a typed WriteErrorInfo, any
    // other throw gets wrapped in InternalError so the Prod contract holds
    // ("unexpected throw → 500 with sanitized body"). We intentionally do NOT
    // catch further out (runBatch still sees these as exceptions via
    // writeFailure, not via a rethrow) so batches roll back naturally.
    let result: WriteResult;
    try {
      result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);
    } catch (e) {
      return writeFailure(wrapToKumiko(e));
    }

    // Runtime shape-guard. The compile-time type WriteHandlerFn already
    // requires `Promise<WriteResult>`, but custom handlers wired through
    // r.writeHandler(name, schema, fn, opts) sometimes slip through with
    // `Promise<{id: string}>` — TypeScript misses it under structural-
    // widening, the dispatcher then reads .isSuccess on undefined and
    // crashes obscure. Surface a clear actionable message instead.
    if (!isWriteResultShape(result)) {
      return writeFailure(
        new InternalError({
          message:
            `Write handler "${type}" returned an invalid shape. Expected WriteResult ` +
            `({ isSuccess: true, data: ... } or writeFailure(err)), got ${describeShape(result)}. ` +
            `Use defineWriteHandler() or wrap the return as { isSuccess: true as const, data: ... }.`,
        }),
      );
    }

    if (result.isSuccess) {
      try {
        await runLifecycle(type, result.data, handlerContext, afterCommitHooks);
      } catch (e) {
        return writeFailure(wrapToKumiko(e));
      }

      // jobRunner has external side-effects (BullMQ enqueue) — must NOT
      // fire for rolled-back writes. Defer to afterCommit.
      if (jobRunner) {
        afterCommitHooks.push(() =>
          jobRunner.handleEvent(type, (parsed.data ?? {}) as DbRow, user),
        );
      }
    }

    // Response-guard: block Secret<> leaks in write responses (SaveContext
    // data / previous / changes). Feature code that fed a plaintext through
    // to the return payload fails here instead of hitting the client.
    if (result.isSuccess) assertNoSecretLeak(result.data);
    return result;
  }

  // Core batch logic extracted so write() and command() can reuse it
  // (a single write = batch of one, running in its own transaction).
  async function runBatch(
    commands: readonly BatchCommand[],
    user: SessionUser,
    requestId?: string,
  ): Promise<BatchResult> {
    if (commands.length === 0) {
      return { isSuccess: true, results: [] };
    }

    // Idempotency: if the same requestId has already been processed, return the
    // cached result without re-executing. The cache holds the full BatchResult.
    if (requestId && idempotency) {
      const cached = await idempotency.check(requestId);
      if (cached) {
        const parsed = parseJsonSafe<BatchResult | null>(cached, null);
        if (parsed) return parsed;
        // corrupted cache entry — treat as miss, let the request re-run
      }
    }

    // Wrap return paths: cache the final result under requestId so retries get
    // the same answer (both success and failure results are cached).
    const finalize = async (result: BatchResult): Promise<BatchResult> => {
      if (requestId && idempotency) {
        await idempotency.store(requestId, result);
      }
      return result;
    };

    const afterCommitHooks: AfterCommitHook[] = [];
    const results: WriteResult[] = [];

    // Flush afterCommit hooks in parallel. Errors are logged, not rethrown:
    // the writes are already committed, we can't undo them.
    //
    // Parallelisation is safe because afterCommit hooks are deferred side-
    // effects (e.g. feature-level postSave hooks in afterCommit phase)
    // that don't depend on each other — the in-transaction work already ran
    // sequentially inside the lifecycle pipeline where ordering matters. If a
    // future hook ever needs ordering, it should do its sequencing internally
    // (one hook pushing multiple sub-calls) rather than relying on the
    // flush-loop order.
    const flushAfterCommit = async () => {
      const outcomes = await Promise.allSettled(afterCommitHooks.map((hook) => hook()));
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          const detail =
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
          const msg = "afterCommit hook failed";
          if (context.log) context.log.error(msg, { error: detail });
          else console.error(`[dispatcher] ${msg}: ${detail}`);
        }
      }
    };

    // Fires the batch-level system hooks with every successful save/delete
    // context from this run. Called after flushAfterCommit so per-save hooks
    // have all completed first; errors are isolated inside lifecycleHooks.
    const flushBatchHooks = async () => {
      try {
        const saves: SaveContext[] = [];
        const deletes: DeleteContext[] = [];
        for (const r of results) {
          if (!r.isSuccess) continue;
          if (!isLifecycleResult(r.data)) continue;
          if (r.data.kind === "save") saves.push(r.data);
          else if (r.data.kind === "delete") deletes.push(r.data);
        }
        if (saves.length > 0 && lifecycle) await lifecycle.runPostSaveBatch(saves, context);
        if (deletes.length > 0 && lifecycle) await lifecycle.runPostDeleteBatch(deletes, context);
      } catch (e) {
        // Batch hooks must never fail the batch — the commit already happened.
        // Pass the raw error so the logger preserves stack + cause chain;
        // collapsing to .message hides exactly what ops needs to debug.
        const msg = "batch hook flush failed";
        if (context.log) context.log.error(msg, { error: e });
        else console.error(`[dispatcher] ${msg}:`, e);
      }
    };

    const db = context.db as DbConnection | undefined;
    if (!db) {
      // Without a DB connection there is no transaction to open. Fall back to
      // sequential execution — useful for unit tests that don't touch the DB.
      // Each command runs independently; a failure stops the batch.
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (!cmd) continue;
        const res = await executeNestedWrite(
          cmd.type,
          cmd.payload,
          user,
          undefined,
          afterCommitHooks,
        );
        results.push(res);
        if (!res.isSuccess) {
          // No tx means no rollback — but we still drop afterCommit hooks,
          // matching the semantic "failure = side-effects don't fire".
          return finalize({ isSuccess: false, error: res.error, failedIndex: i, results });
        }
      }
      await flushAfterCommit();
      await flushBatchHooks();
      return finalize({ isSuccess: true, results });
    }

    try {
      await db.transaction(async (tx) => {
        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i];
          if (!cmd) continue;
          const res = await executeNestedWrite(cmd.type, cmd.payload, user, tx, afterCommitHooks);
          results.push(res);
          if (!res.isSuccess) {
            throw new BatchRollback(i, res.error);
          }
        }
      });
    } catch (e) {
      if (e instanceof BatchRollback) {
        return finalize({
          isSuccess: false,
          error: e.failureError,
          failedIndex: e.failedIndex,
          results,
        });
      }
      // Unexpected throw — typically a DB driver error from commit/rollback.
      // executeWrite already traps handler + lifecycle throws into WriteResult,
      // so anything reaching here is infrastructure-level. Wrap as InternalError
      // so the contract ("non-Kumiko → InternalError") holds uniformly.
      return finalize({
        isSuccess: false,
        error: toWriteErrorInfo(wrapToKumiko(e)),
        failedIndex: results.length,
        results,
      });
    }

    // Commit succeeded — fire deferred side-effects.
    await flushAfterCommit();
    await flushBatchHooks();
    return finalize({ isSuccess: true, results });
  }

  // Unwrap a BatchResult into a single WriteResult for write()/command().
  // Picks the last result if present (the failing one for failures, the only
  // one for successful single writes). Falls back to a synthetic error if the
  // batch didn't produce any results (unexpected).
  function unwrapSingle(batchResult: BatchResult): WriteResult {
    if (batchResult.isSuccess) {
      return (
        batchResult.results[0] ?? writeFailure(new InternalError({ message: "empty_batch_result" }))
      );
    }
    return (
      batchResult.results[batchResult.failedIndex] ?? {
        isSuccess: false,
        error: batchResult.error,
      }
    );
  }

  // Build the per-hook context every auth-claims invocation gets. Claims
  // hooks run OUTSIDE any request transaction (login is itself the root
  // operation, not a nested call) and read-only — so the TenantDb is
  // scoped as "tenant" and no tx is threaded through. Hooks that need
  // cross-tenant lookups opt in explicitly via queryAs(systemUser, ...).
  function buildAuthClaimsContext(user: SessionUser): AuthClaimsContext {
    const dbSource: DbConnection | undefined = context.db as DbConnection | undefined;
    if (!dbSource) {
      throw new InternalError({
        message:
          "dispatcher.resolveAuthClaims requires a database connection — none is configured.",
      });
    }
    const db = createTenantDb(dbSource, user.tenantId, "tenant", context.tracer, context.meter);
    const configAccessor = context._configAccessorFactory
      ? context._configAccessorFactory({ user: { id: user.id, tenantId: user.tenantId }, db })
      : undefined;
    return {
      db,
      queryAs: (asUser: SessionUser, qn: string, payload: unknown) =>
        executeQuery(qn, payload, asUser),
      ...(configAccessor && { config: configAccessor }),
    };
  }

  async function resolveAuthClaimsFn(user: SessionUser): Promise<Record<string, unknown>> {
    const hooks = registry.getAuthClaimsHooks();
    if (hooks.length === 0) return {};
    return runAuthClaimsResolver({
      user,
      hooks,
      contextFactory: buildAuthClaimsContext,
      ...(context.log && { log: context.log }),
    });
  }

  return {
    async write(typeOrRef, payload, user, requestId?) {
      const type = resolveType(typeOrRef);
      // Idempotency handled inside runBatch (caches BatchResult under requestId).
      const batchResult = await runBatch([{ type, payload }], user, requestId);
      return unwrapSingle(batchResult);
    },

    batch: runBatch,

    query: (typeOrRef, payload, user) => executeQuery(resolveType(typeOrRef), payload, user),

    async command(typeOrRef, payload, user) {
      const type = resolveType(typeOrRef);
      const batchResult = await runBatch([{ type, payload }], user);
      const result = unwrapSingle(batchResult);

      if (!result.isSuccess) {
        throw reraiseAsKumikoError(result.error);
      }
    },

    resolveAuthClaims: resolveAuthClaimsFn,
  };
}

// Non-KumikoError → InternalError with cause preserved for the log. Kumiko
// errors pass through untouched so their code/httpStatus survives.
function wrapToKumiko(e: unknown): KumikoError {
  if (isKumikoError(e)) return e;
  if (e instanceof Error) return new InternalError({ cause: e });
  return new InternalError({ message: String(e) });
}
