import { eq } from "drizzle-orm";
import { requestContext } from "../api/request-context";
import type { DbConnection, DbTx } from "../db/connection";
import { buildDrizzleTable } from "../db/table-builder";
import { createTenantDb } from "../db/tenant-db";
import { hasAccess } from "../engine/access";
import { checkWriteFields, filterReadFields } from "../engine/field-access";
import { defineTransitions, guardTransition } from "../engine/state-machine";
import type {
  AppContext,
  DeleteContext,
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
import { runValidation } from "../engine/validation";
import {
  AccessDeniedError,
  FrameworkReasons,
  InternalError,
  isKumikoError,
  type KumikoError,
  NotFoundError,
  reraiseAsKumikoError,
  toWriteErrorInfo,
  ValidationError,
  validationErrorFromZod,
  type WriteErrorInfo,
  writeFailure,
} from "../errors";
import { append as appendEvent } from "../event-store/event-store";
import {
  createMetricsHandle,
  createNoopMetricsHandle,
  emitDispatcherError,
  emitDispatcherHandler,
  getFallbackMeter,
  getFallbackTracer,
  registerStandardMetrics,
} from "../observability";
import { parseJsonSafe } from "../utils/safe-json";
import type { EventLog } from "./event-log";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";
import { runProjections } from "./projections-runner";

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
  eventLog?: EventLog;
  lifecycle?: LifecycleHooks;
  jobRunner?: JobRunnerRef;
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
};

export function createDispatcher(
  registry: Registry,
  context: AppContext,
  options: DispatcherOptions = {},
): Dispatcher {
  const { idempotency, eventLog, lifecycle, jobRunner } = options;

  // Pre-build tables and transition maps for auto-guard (avoid per-request allocation)
  const tableCache = new Map<string, ReturnType<typeof buildDrizzleTable>>();
  const transitionCache = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>();

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
  }): ReadonlyMap<string, ReadonlySet<string>> {
    // Scope by entity — `fieldName` alone collides across entities (e.g. both
    // `invoice.status` and `driverOrder.status` exist with different maps),
    // which would apply the wrong transition rules to whichever entity arrives
    // second.
    const key = `${args.entityName}:${args.fieldName}`;
    if (transitionCache.has(key))
      return transitionCache.get(key) as ReadonlyMap<string, ReadonlySet<string>>;
    const transitions = defineTransitions(args.map);
    transitionCache.set(key, transitions);
    return transitions;
  }

  // ctx.emit — append a pub/sub event onto the events-table in the current tx.
  //
  // Seit D.5 läuft pub/sub über denselben Event-Store wie die Aggregate-Events:
  // ein separater synthetic stream (aggregateType = "pubsub", neue aggregateId
  // pro Emit, version = 1). Vorteile:
  //   - Ein einziger ordered log — async subscribers (r.postEvent) können
  //     von der gleichen Cursor-Infrastruktur angebunden werden.
  //   - Keine separate Outbox-Tabelle / Poller / Broker mehr (raus in D.5).
  //   - Events sind einheitlich tenantId-isoliert + idempotency-indexiert.
  //
  // Delivery: at-least-once durch den event-dispatcher. Handler müssen
  // idempotent sein (gleiche Regel wie vorher beim Outbox).
  async function emitEvent(
    eventType: string,
    payload: unknown,
    user: SessionUser,
    tx: DbTx | undefined,
  ): Promise<void> {
    const dbSource: DbConnection | DbTx | undefined =
      tx ?? (context.db as DbConnection | undefined);
    if (!dbSource) {
      throw new Error(
        `ctx.emit("${eventType}") requires a database connection — none is configured.`,
      );
    }

    // Strict schema validation (E.3). r.defineEvent is the single source of
    // truth for what a feature is allowed to emit: the registry holds the
    // event's Zod schema, and ctx.emit validates the payload against it
    // BEFORE the event hits the events-table. Two failure modes:
    //   1. Event was never registered → typo or forgotten r.defineEvent.
    //      Throw with a help message so the feature author sees it at the
    //      emit site.
    //   2. Payload doesn't match schema → standard ValidationError, same
    //      contract as HTTP-level schema validation.
    // Without this, a broken payload would only surface at consumer-time —
    // by then the event is durably in the log and duplicate deliveries
    // amplify the blast.
    const eventDef = registry.getEvent(eventType);
    if (!eventDef) {
      throw new InternalError({
        message: `ctx.emit("${eventType}") — event not registered. Call r.defineEvent(shortName, schema) in a feature; ctx.emit expects the qualified name returned by defineEvent (e.g. "<feature>:event:<short>").`,
      });
    }
    const parsed = eventDef.schema.safeParse(payload ?? {});
    if (!parsed.success) {
      throw validationErrorFromZod(parsed.error);
    }
    const validatedPayload = parsed.data as Record<string, unknown>;

    const reqCtx = requestContext.get();
    // System-scope events carry the zero-UUID as a marker on the in-memory
    // SessionUser — we still persist it here so every event has a concrete
    // tenantId (events-table requires notNull). The zero-UUID is a first-
    // class value meaning "system/global". Consumers interpret it.
    const tenantId = user.tenantId;

    // Synthetic aggregate for pub/sub: a fresh UUID per emit, version = 1.
    // Keeps the unique(aggregate_id, version) constraint satisfied without
    // tracking an aggregate stream — pub/sub events are one-shot by design.
    // Using globalThis.crypto keeps the code node/bun/browser-safe.
    const aggregateId = globalThis.crypto.randomUUID();

    await appendEvent(dbSource, {
      aggregateId,
      aggregateType: "pubsub",
      tenantId,
      expectedVersion: 0,
      type: eventType,
      payload: validatedPayload,
      metadata: {
        userId: user.id,
        ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
      },
    });
  }

  async function logEvent(type: string, payload: unknown, user: SessionUser): Promise<void> {
    // skip: no eventLog configured, nothing to persist
    if (!eventLog) return;
    await eventLog.append({
      type,
      payload: (payload ?? {}) as Record<string, unknown>,
      userId: user.id,
      tenantId: user.tenantId,
    });
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
    const db = dbSource
      ? createTenantDb(
          dbSource,
          user.tenantId,
          isSystem ? "system" : "tenant",
          context.tracer,
          context.meter,
        )
      : undefined;
    const reqCtx = requestContext.get();
    const log = context.log?.child({
      handler: type,
      tenantId: user.tenantId,
      userId: user.id,
      ...(reqCtx && { requestId: reqCtx.requestId }),
    });
    const notify = context._notifyFactory ? context._notifyFactory(user, user.tenantId) : undefined;

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
      emit: async (eventType: string, payload: unknown) => {
        await emitEvent(eventType, payload, user, tx);
      },
    };

    // Registry is always the dispatcher's registry — injecting it here lets
    // tests/callers pass `context` without `registry` and still get a valid
    // HandlerContext. The spread-then-assign order matters: anything in
    // `context` can be overridden, but we want the authoritative registry
    // from the dispatcher's own closure to win.
    return {
      ...context,
      registry,
      db,
      log,
      notify,
      tracer,
      metrics,
      _userId: user.id,
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
            // Write handlers report failure via WriteResult.isSuccess=false.
            if (
              operation === "write" &&
              result &&
              typeof result === "object" &&
              "isSuccess" in result &&
              (result as { isSuccess: boolean }).isSuccess === false
            ) {
              const err = (result as { error?: { code?: string } }).error;
              success = false;
              errorClass = err?.code ?? "UnknownError";
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
        } else if ("rows" in (result as Record<string, unknown>)) {
          const r = result as { rows: Record<string, unknown>[]; nextCursor: string | null };
          result = {
            ...r,
            rows: r.rows.map((row) => filterReadFields(entity, row, user)),
          };
        } else {
          result = filterReadFields(entity, result as Record<string, unknown>, user);
        }
      }
    }

    await logEvent(type, parsed.data, user);
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
    if (!lifecycle || !data || typeof data !== "object" || !("kind" in data)) {
      handlerContext.log?.debug(
        `runLifecycle: skipping ${type} — ${!lifecycle ? "no lifecycle pipeline" : "result is not a lifecycle kind"}`,
      );
      return;
    }
    const result = data as LifecycleResult;

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

  async function executeWriteInner(
    type: string,
    payload: unknown,
    user: SessionUser,
    tx: DbTx | undefined,
    afterCommitHooks: AfterCommitHook[],
  ): Promise<WriteResult> {
    const handler = registry.getWriteHandler(type);
    if (!handler) return writeFailure(new NotFoundError("handler", type));

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

    const hookErrors = runValidation(registry, type, parsed.data as Record<string, unknown>);
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
        const fieldsToCheck = (parsed.data as Record<string, unknown>)["changes"] as
          | Record<string, unknown>
          | undefined;
        const writePayload = fieldsToCheck ?? (parsed.data as Record<string, unknown>);
        const deniedField = checkWriteFields(entity, writePayload, user);
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
        const parsedData = parsed.data as Record<string, unknown>;
        const changes = (parsedData["changes"] as Record<string, unknown>) ?? parsedData;
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
          if (entity.softDelete && (row as Record<string, unknown>)["isDeleted"] === true) {
            continue;
          }
          const currentValue = (row as Record<string, unknown>)[fieldName] as string;
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

    if (result.isSuccess) {
      try {
        await runLifecycle(type, result.data, handlerContext, afterCommitHooks);
      } catch (e) {
        return writeFailure(wrapToKumiko(e));
      }

      // jobRunner and eventLog have external side-effects — they must NOT fire
      // for rolled-back writes. Defer to afterCommit in all paths.
      if (jobRunner) {
        afterCommitHooks.push(() =>
          jobRunner.handleEvent(type, (parsed.data ?? {}) as Record<string, unknown>, user),
        );
      }
      const parsedData = parsed.data;
      afterCommitHooks.push(() => logEvent(type, parsedData, user));
    }

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
          const data = r.data as { kind?: string } | undefined;
          if (!data || typeof data !== "object") continue;
          if (data.kind === "save") saves.push(data as unknown as SaveContext);
          else if (data.kind === "delete") deletes.push(data as unknown as DeleteContext);
        }
        if (saves.length > 0 && lifecycle) await lifecycle.runPostSaveBatch(saves, context);
        if (deletes.length > 0 && lifecycle) await lifecycle.runPostDeleteBatch(deletes, context);
      } catch (e) {
        // Batch hooks must never fail the batch — the commit already happened.
        const msg = "batch hook flush failed";
        const detail = e instanceof Error ? e.message : String(e);
        if (context.log) context.log.error(msg, { error: detail });
        else console.error(`[dispatcher] ${msg}: ${detail}`);
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
        const res = await executeWrite(cmd.type, cmd.payload, user, undefined, afterCommitHooks);
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
          const res = await executeWrite(cmd.type, cmd.payload, user, tx, afterCommitHooks);
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
  };
}

// Non-KumikoError → InternalError with cause preserved for the log. Kumiko
// errors pass through untouched so their code/httpStatus survives.
function wrapToKumiko(e: unknown): KumikoError {
  if (isKumikoError(e)) return e;
  if (e instanceof Error) return new InternalError({ cause: e });
  return new InternalError({ message: String(e) });
}
