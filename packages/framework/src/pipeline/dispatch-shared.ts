import { requestContext } from "../api/request-context";
import type { DbConnection, DbRunner, DbTx } from "../db/connection";
import { runInSavepoint, selectMany } from "../db/query";
import type { buildEntityTable } from "../db/table-builder";
import { createTenantDb } from "../db/tenant-db";
import type { defineTransitions } from "../engine/state-machine";
import type { EffectiveFeaturesResolver } from "../engine/tier-resolver-extension";
import type {
  AggregateStreamHandle,
  AppContext,
  AppendEventArgs,
  AppendEventFn,
  AuthClaimsContext,
  FetchForWritingArgs,
  HandlerContext,
  JobRunnerRef,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types";
import type { TenantId } from "../engine/types/identifiers";
import {
  FeatureDisabledError,
  InternalError,
  VersionConflictError,
  type WriteErrorInfo,
} from "../errors";
import {
  archiveStream as archiveStreamHelper,
  isStreamArchived,
  restoreStream as restoreStreamHelper,
} from "../event-store/archive";
import { VersionConflictError as EventStoreVersionConflictError } from "../event-store/errors";
import {
  getStreamVersion,
  loadAggregate,
  loadAggregateAsOf,
  type StoredEvent,
} from "../event-store/event-store";
import {
  type LoadAggregateWithSnapshotOptions,
  type LoadAggregateWithSnapshotResult,
  loadAggregateWithSnapshot,
  type SnapshotReducer,
  saveSnapshot,
} from "../event-store/snapshot";
import { upcastStoredEvent, upcastStoredEvents } from "../event-store/upcaster";
import { createFileContext } from "../files/file-handle";
import {
  createMetricsHandle,
  createNoopMetricsHandle,
  emitDispatcherError,
  emitDispatcherHandler,
  type getFallbackMeter,
  getFallbackTracer,
} from "../observability";
import { buildBucketKey } from "../rate-limit";
import { createTzContext } from "../time";
import { appendDomainEventCore } from "./append-event-core";
import { resolveAuthClaims as runAuthClaimsResolver } from "./auth-claims-resolver";
import { executeQuery } from "./dispatch-query";
import { executeWrite } from "./dispatch-write";
import {
  type AfterCommitHook,
  dispatcherSpanAttributes,
  isFailedWriteResult,
} from "./dispatcher-utils";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";

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

// Bundles everything the dispatch-phase functions (query/write/batch) need —
// hoisted to module scope out of createDispatcher's former closure, so those
// captures travel explicitly instead of implicitly.
export type DispatchContext = {
  registry: Registry;
  appContext: AppContext;
  idempotency: IdempotencyGuard | undefined;
  lifecycle: LifecycleHooks | undefined;
  jobRunner: JobRunnerRef | undefined;
  effectiveFeatures: EffectiveFeaturesResolver | undefined;
  tableCache: Map<string, ReturnType<typeof buildEntityTable>>;
  transitionCache: Map<string, ReturnType<typeof defineTransitions>>;
  tracer: ReturnType<typeof getFallbackTracer>;
  meter: ReturnType<typeof getFallbackMeter>;
};

// Narrowing-helper: AppContext.db ist DbConnection|TenantDb|undefined. Die
// dispatch-Pfade brauchen DbConnection (oder DbTx aus Caller-Scope) für
// appendEvent/projection-writes; TenantDb-Branch wird hier ausgeschlossen.
export function resolveDbSource(
  ctx: DispatchContext,
  tx: DbTx | undefined,
): DbConnection | DbTx | undefined {
  const { appContext: context } = ctx;
  return tx ?? (context.db as DbConnection | undefined); // @cast-boundary db-operator
}

// ctx.appendEvent — append a domain event onto a specific aggregate stream
// in the current tx, then fire matching inline projections. Core logic
// lives in appendDomainEventCore; this wrapper just locates dbSource +
// stringifies the SessionUser id for the shared helper.
async function appendDomainEvent(
  ctx: DispatchContext,
  args: AppendEventArgs,
  user: SessionUser,
  tx: DbTx | undefined,
  callerFeature: string | undefined,
): Promise<void> {
  const { registry } = ctx;
  const dbSource = resolveDbSource(ctx, tx);
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

export function buildHandlerContext(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  tx?: DbTx,
  afterCommitHooks?: AfterCommitHook[],
  includeDeleted?: boolean,
): HandlerContext {
  const { registry, appContext: context, effectiveFeatures, jobRunner } = ctx;
  const isSystem = registry.isHandlerSystemScoped(type);
  // The outer dispatcher receives a DbConnection from the server/stack;
  // AppContext's `db` union also allows TenantDb (for downstream hook calls),
  // but at this point we're the root of the pipeline — cast is safe.
  const dbSource = resolveDbSource(ctx, tx);
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
      ? context._configAccessorFactory({
          user: { id: user.id, tenantId: user.tenantId },
          db,
          secrets: context.secrets,
        })
      : undefined;
  // ctx.files resolved per-tenant through file-foundation (lazy — the
  // provider is only resolved when a handle actually does I/O). Boot wires
  // _fileProviderResolver when a file-provider plugin is mounted; falls back
  // to a statically-injected context.files (tests).
  const fileResolver = context._fileProviderResolver;
  const files = fileResolver ? createFileContext(() => fileResolver(user.tenantId)) : context.files;

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
    query: (targetType: string, payload: unknown) =>
      executeQuery(ctx, targetType, payload, user, tx), // @wrapper-known semantic-alias
    queryAs: (asUser: SessionUser, targetType: string, payload: unknown) =>
      executeQuery(ctx, targetType, payload, asUser, tx), // @wrapper-known semantic-alias
    write: async (targetType: string, payload: unknown) => {
      const res = await executeWrite(ctx, targetType, payload, user, tx, bridgeSink);
      return res;
    },
    writeAs: async (asUser: SessionUser, targetType: string, payload: unknown) => {
      const res = await executeWrite(ctx, targetType, payload, asUser, tx, bridgeSink);
      return res;
    },
    // Strict + unsafe share the same runtime — only the type-surface
    // differs. The strict signature is what's exposed to typed callers;
    // unsafe is the explicit escape-hatch for runtime-pluggable events.
    appendEvent: (async (args: AppendEventArgs) => {
      await appendDomainEvent(ctx, args, user, tx, registry.getHandlerFeature(type));
    }) as AppendEventFn, // @cast-boundary engine-bridge
    unsafeAppendEvent: async (args: AppendEventArgs) => {
      await appendDomainEvent(ctx, args, user, tx, registry.getHandlerFeature(type));
    },
    // Savepoint-scoped append: catches a losing writer's VersionConflictError
    // without poisoning the rest of the handler's transaction. Bun.SQL/
    // postgres.js abort the WHOLE begin() on an uncaught statement error
    // (SQLSTATE 25P02) even if the JS error is caught — runInSavepoint
    // wraps the append in a real SAVEPOINT so only that nested scope rolls
    // back on conflict, and subsequent statements in the outer tx (e.g. a
    // dedup-anchor insert) still succeed. Use when a handler must react to
    // losing a concurrent-append race instead of failing the whole write.
    tryAppendEvent: async (args: AppendEventArgs) => {
      if (!tx) {
        throw new InternalError({
          message: `ctx.tryAppendEvent("${args.type}") requires an active transaction — no tx is threaded through this call.`,
        });
      }
      try {
        const event = await runInSavepoint(tx, (sp) =>
          appendDomainEventCore(
            {
              registry,
              db: sp as DbRunner,
              tenantId: user.tenantId,
              userId: String(user.id),
              callSiteLabel: "ctx.tryAppendEvent",
              callerFeature: registry.getHandlerFeature(type),
            },
            args,
          ),
        );
        return { ok: true as const, event };
      } catch (e) {
        if (e instanceof EventStoreVersionConflictError) {
          return { ok: false as const, conflict: e };
        }
        throw e;
      }
    },
    fetchForWriting: async (args: FetchForWritingArgs): Promise<AggregateStreamHandle> => {
      const dbSource = resolveDbSource(ctx, tx);
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
          ctx,
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
      const dbSource = resolveDbSource(ctx, tx);
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
      const dbSource = resolveDbSource(ctx, tx);
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
      const dbSource = resolveDbSource(ctx, tx);
      if (!dbSource) {
        throw new InternalError({
          message: `ctx.restoreStream("${aggregateId}") requires a database connection — none is configured.`,
        });
      }
      await restoreStreamHelper(dbSource, user.tenantId, aggregateId);
    },
    isStreamArchived: async (aggregateId: string): Promise<boolean> => {
      const dbSource = resolveDbSource(ctx, tx);
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
      readonly snapshotVersion?: number;
    }): Promise<void> => {
      const dbSource = resolveDbSource(ctx, tx);
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
        snapshotVersion: snapshotArgs.snapshotVersion,
      });
    },
    loadAggregateWithSnapshot: async <TState extends Record<string, unknown>>(
      aggregateId: string,
      reducer: SnapshotReducer<TState>,
      initial: TState,
      loadOptions?: Omit<LoadAggregateWithSnapshotOptions, "upcastEvent">,
    ): Promise<LoadAggregateWithSnapshotResult<TState>> => {
      const dbSource = resolveDbSource(ctx, tx);
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
        {
          ...loadOptions,
          upcastEvent: (event) => upcastStoredEvent(event, upcasters, upcastCtx), // @wrapper-known semantic-alias
        },
      );
    },
    queryProjection: async <T = Record<string, unknown>>(
      qualifiedName: string,
      queryOptions?: { readonly unsafeAllTenants?: boolean },
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
      const dbSource = resolveDbSource(ctx, tx);
      if (!dbSource) {
        throw new InternalError({
          message: `ctx.queryProjection("${qualifiedName}") requires a database connection — none is configured.`,
        });
      }
      // Introspect for a tenant_id column on the projection table. Auto-
      // filter keeps cross-tenant leaks out unless the handler explicitly
      // opts in. Works with any drizzle-table whose tenant column is named
      // tenantId on the JS side.
      const tenantCol = (projTable as Record<string, unknown>)["tenantId"];
      const where =
        tenantCol && !queryOptions?.unsafeAllTenants ? { tenantId: user.tenantId } : undefined;
      const rows = await selectMany<Record<string, unknown>>(dbSource, projTable, where);
      return rows as readonly T[]; // @cast-boundary engine-payload
    },
    // Thin pass-through: one resolve impl lives on the dispatcher, the
    // handler surface just forwards the call so both entry points (login
    // handler via ctx.resolveAuthClaims, switch-tenant route via
    // dispatcher.resolveAuthClaims) cannot drift.
    resolveAuthClaims: (claimsUser: SessionUser) => resolveAuthClaimsFn(ctx, claimsUser), // @wrapper-known semantic-alias

    // Feature-effective check for in-handler opt-in logic. Scope:
    // **current user's tenant** — for cross-tenant lookups (rare,
    // SysAdmin operations) read effectiveFeatures(otherTenantId) directly.
    // When the feature-toggles or tier-engine feature isn't wired (no
    // effectiveFeatures callback), always returns true — apps without
    // tier-cuts treat all features on.
    //
    // Falls back to the live trialGate when the sync set says the feature
    // is off — the sync set never contains trial-tier features (time-
    // derived, can't boot-cache), so without this a trial tenant checking
    // a companion feature's toggle would silently read `false` even though
    // the dispatch gate already lets trial-tier handlers run.
    hasFeature: async (featureName: string): Promise<boolean> => {
      if (!effectiveFeatures) return true;
      if (effectiveFeatures(user.tenantId).has(featureName)) return true;
      if (!effectiveFeatures.trialGate) return false;
      return effectiveFeatures.trialGate(user.tenantId, featureName);
    },
  };

  // Registry is always the dispatcher's registry — injecting it here lets
  // tests/callers pass `context` without `registry` and still get a valid
  // HandlerContext. The spread-then-assign order matters: anything in
  // `context` can be overridden, but we want the authoritative registry
  // from the dispatcher's own closure to win.
  // ctx.tz ist immer da. Tenant + User-Defaults kommen aus dem
  // SessionUser sobald die Felder existieren — bis dahin "UTC". Ein
  // app-injizierter GeoTzProvider (context.geoTzProvider) speist
  // ctx.tz.fromCoordinates / fromAddress.
  const tz = createTzContext(
    context.geoTzProvider !== undefined ? { geoTz: context.geoTzProvider } : {},
  );

  return {
    ...context,
    registry,
    db,
    log,
    notify,
    ...(config && { config }),
    ...(files && { files }),
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
    // Lets write handlers call ctx.jobRunner.dispatch(...) directly, same
    // as a follow-up job would (test-stack.ts wires the matching runner).
    ...(jobRunner && { jobRunner }),
    // ctx.user als Convenience-Alias auf event.user. Der typisch-
    // intuitive Pfad „der Context kennt seinen User" — ohne den
    // schreiben Handler `event.user.tenantId` und brechen sich die
    // Finger an typo-resistenten ctx.user-Patterns. Identisch zum
    // event.user-Wert; Identity-Switches nutzen weiterhin queryAs/writeAs.
    user,
    _userId: user.id,
    _tenantId: user.tenantId,
    _handlerType: type,
    ...(includeDeleted && { includeDeleted: true }),
    ...bridge,
  } as HandlerContext; // @cast-boundary engine-bridge
}

// Wrap handler execution in a dispatcher.handler span AND emit the standard
// dispatcher metrics (duration + error counter). Errors are re-thrown so
// control flow stays identical to the uninstrumented path.
//
// Writes are special-cased: executeWriteInner converts thrown handler errors
// into a WriteResult with isSuccess=false (rather than letting them bubble).
// We inspect the result to paint the dispatcher span + error counter on
// those structural failures too — otherwise "handler threw" would only show
// up when the caller forgot to use writeFailure().
export async function runHandlerInstrumented<T>(
  ctx: DispatchContext,
  type: string,
  operation: "query" | "write" | "stream",
  user: SessionUser,
  inner: () => Promise<T>,
): Promise<T> {
  const { tracer: dispatcherTracer, meter: dispatcherMeter, registry } = ctx;
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

// Generator-native counterpart to runHandlerInstrumented — a stream's
// lifetime spans every `for await` pull the caller makes, so the span
// can't be scoped via withSpan's single-callback shape. startSpan/end
// bracket the whole yield* instead; metrics land in the same finally
// path so success/failure/throw all hit one emit, like the Promise path.
export async function* runStreamInstrumented<T>(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  inner: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  const { tracer: dispatcherTracer, meter: dispatcherMeter, registry } = ctx;
  const start = performance.now();
  let success = true;
  let errorClass: string | undefined;
  const span = dispatcherTracer.startSpan("kumiko.dispatcher.handler", {
    attributes: dispatcherSpanAttributes(type, "stream", user, registry.getHandlerFeature(type)),
  });
  try {
    yield* inner();
  } catch (error) {
    success = false;
    errorClass = error instanceof Error && error.name ? error.name : "UnknownError";
    span.setStatus("error", errorClass);
    throw error;
  } finally {
    span.end();
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

// Feature-toggle gate. Returns the error to fold into a WriteFailure in the
// write path, or throws for the query path (where throws flow through the
// same outer instrumentation wrapper as other dispatcher errors).
//
// When `effectiveFeatures` is not wired (tests, apps without feature-toggles
// loaded), every handler is treated as enabled — the gate is a pure
// pass-through in that common case.
export async function checkFeatureEnabled(
  ctx: DispatchContext,
  qualifiedHandler: string,
  tenantId: TenantId,
): Promise<import("../errors").FeatureDisabledError | undefined> {
  const { effectiveFeatures, registry } = ctx;
  if (!effectiveFeatures) return undefined;
  const owner = registry.getHandlerFeature(qualifiedHandler);
  // skip: handler without an owning feature cannot be toggled — shouldn't
  // happen for registry-built handlers, but guards against edge-case
  // runtime injections.
  if (!owner) return undefined;
  const set = effectiveFeatures(tenantId);
  if (set.has(owner)) return undefined;
  // Feature is off for the stored tier — give the live trial-gate a last
  // chance. Time-derived (tenant.inserted_at + window), so it can't live in
  // the boot-cached sync resolver; consulted only on this already-disabled
  // cold path, never on the hot enabled path.
  if (effectiveFeatures.trialGate && (await effectiveFeatures.trialGate(tenantId, owner))) {
    return undefined;
  }
  return new FeatureDisabledError(owner, qualifiedHandler);
}

export async function ensureFeatureEnabled(
  ctx: DispatchContext,
  qualifiedHandler: string,
  tenantId: TenantId,
): Promise<void> {
  const err = await checkFeatureEnabled(ctx, qualifiedHandler, tenantId);
  if (err) throw err;
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
export async function enforceRateLimit(
  ctx: DispatchContext,
  rateLimit: import("../engine/types").RateLimitOption | undefined,
  handlerName: string,
  user: SessionUser,
): Promise<void> {
  const { appContext: context } = ctx;
  // skip: defence-in-depth — both call-sites already gate on
  //       handler.rateLimit !== undefined, so this branch only fires
  //       if a future caller forgets the inline check.
  if (!rateLimit) return;
  const reqCtx = requestContext.get();
  const bucket = buildBucketKey(rateLimit, {
    handlerName,
    user,
    ip: reqCtx?.ip,
  });
  // skip: ip-bucket + no IP (non-HTTP entry point) — pass through before
  // requiring a resolver; HTTP path always has an IP + L1/L2 middleware.
  if (bucket.kind === "skip") return;
  if (!context.rateLimit) {
    throw new InternalError({
      message: `Handler "${handlerName}" declares rateLimit but no RateLimitResolver is configured. Load the rate-limiting feature or remove the option.`,
    });
  }
  await context.rateLimit.enforce(bucket.key, {
    limit: rateLimit.limit,
    windowSeconds: rateLimit.windowSeconds,
    cost: rateLimit.cost,
  });
}

// Build the per-hook context every auth-claims invocation gets. Claims
// hooks run OUTSIDE any request transaction (login is itself the root
// operation, not a nested call) and read-only — so the TenantDb is
// scoped as "tenant" and no tx is threaded through. Hooks that need
// cross-tenant lookups opt in explicitly via queryAs(systemUser, ...).
function buildAuthClaimsContext(ctx: DispatchContext, user: SessionUser): AuthClaimsContext {
  const { appContext: context } = ctx;
  const dbSource = resolveDbSource(ctx, undefined);
  if (!dbSource) {
    throw new InternalError({
      message: "dispatcher.resolveAuthClaims requires a database connection — none is configured.",
    });
  }
  const db = createTenantDb(dbSource, user.tenantId, "tenant", context.tracer, context.meter);
  const configAccessor = context._configAccessorFactory
    ? context._configAccessorFactory({
        user: { id: user.id, tenantId: user.tenantId },
        db,
        secrets: context.secrets,
      })
    : undefined;
  return {
    db,
    queryAs: (asUser: SessionUser, qn: string, payload: unknown) =>
      executeQuery(ctx, qn, payload, asUser), // @wrapper-known semantic-alias
    ...(configAccessor && { config: configAccessor }),
  };
}

export async function resolveAuthClaimsFn(
  ctx: DispatchContext,
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const { registry, appContext: context } = ctx;
  const hooks = registry.getAuthClaimsHooks();
  if (hooks.length === 0) return {};
  return runAuthClaimsResolver({
    user,
    hooks,
    contextFactory: (claimsUser: SessionUser) => buildAuthClaimsContext(ctx, claimsUser),
    ...(context.log && { log: context.log }),
  });
}
