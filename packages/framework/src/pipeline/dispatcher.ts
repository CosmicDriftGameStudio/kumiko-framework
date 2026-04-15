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
  HandlerContext,
  HandlerRef,
  JobRunnerRef,
  LifecycleResult,
  Registry,
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
import { parseJsonSafe } from "../utils/safe-json";
import type { EventLog } from "./event-log";
import type { IdempotencyGuard } from "./idempotency";
import type { LifecycleHooks } from "./lifecycle-pipeline";
import { eventOutboxTable, OUTBOX_WAKE_CHANNEL } from "./outbox-table";

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
  // When set, ctx.emit writes into the outbox table and fires a wake-up on
  // this Redis instance after commit. Without it, ctx.emit is a no-op-throw
  // (so features can't accidentally emit without the infra being wired).
  outbox?: {
    redis: import("ioredis").default;
  };
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
  const { idempotency, eventLog, lifecycle, jobRunner, outbox } = options;

  // Pre-build tables and transition maps for auto-guard (avoid per-request allocation)
  const tableCache = new Map<string, ReturnType<typeof buildDrizzleTable>>();
  const transitionCache = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>();

  function getTable(entityName: string): ReturnType<typeof buildDrizzleTable> | undefined {
    if (tableCache.has(entityName)) return tableCache.get(entityName);
    const entity = registry.getEntity(entityName);
    if (!entity) return undefined;
    const table = buildDrizzleTable(entityName, entity);
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

  // Transactional outbox emit. Row INSERTed in the current tx; after commit
  // we publish a wake-up on Redis so the poller picks it up quickly (if the
  // publish fails, the poller's 50ms timer catches the row anyway).
  async function emitEvent(
    eventType: string,
    payload: unknown,
    user: SessionUser,
    tx: DbTx | undefined,
    afterCommitHooks: AfterCommitHook[],
  ): Promise<void> {
    if (!outbox) {
      throw new Error(
        `ctx.emit("${eventType}") called but no outbox is configured on the dispatcher — ` +
          `pass DispatcherOptions.outbox = { redis } when building the server.`,
      );
    }
    const dbSource: DbConnection | DbTx | undefined =
      tx ?? (context.db as DbConnection | undefined);
    if (!dbSource) {
      throw new Error(
        `ctx.emit("${eventType}") requires a database connection — none is configured.`,
      );
    }

    const reqCtx = requestContext.get();
    const metadata: Record<string, unknown> = { userId: user.id };
    if (reqCtx?.requestId) metadata["requestId"] = reqCtx.requestId;

    await dbSource.insert(eventOutboxTable).values({
      tenantId: user.tenantId || null,
      eventType,
      payload: (payload ?? {}) as Record<string, unknown>,
      metadata,
    });

    const redis = outbox.redis;
    const log = context.log;
    afterCommitHooks.push(async () => {
      try {
        await redis.publish(OUTBOX_WAKE_CHANNEL, "");
      } catch (e) {
        // Wake-up publish is an optimisation, not a correctness guarantee —
        // the poller's 50ms timer fallback still picks the row up. Log as
        // warn so ops can see Redis flakiness but tests don't treat it as
        // an error. If no logger is configured we swallow: production
        // setups always attach one, tests without a log are inspecting
        // outbox rows directly.
        if (log) {
          const detail = e instanceof Error ? e.message : String(e);
          log.warn(`outbox wake-up publish failed (poller timer will catch): ${detail}`);
        }
      }
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
      ? createTenantDb(dbSource, user.tenantId, isSystem ? "system" : "tenant")
      : undefined;
    const reqCtx = requestContext.get();
    const log = context.log?.child({
      handler: type,
      tenantId: user.tenantId,
      userId: user.id,
      ...(reqCtx && { requestId: reqCtx.requestId }),
    });
    const notify = context._notifyFactory ? context._notifyFactory(user, user.tenantId) : undefined;

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
        await emitEvent(eventType, payload, user, tx, bridgeSink);
      },
    };

    return {
      ...context,
      db,
      log,
      notify,
      _userId: user.id,
      _handlerType: type,
      ...bridge,
    } as HandlerContext;
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
    const handler = registry.getQueryHandler(type);
    if (!handler) throw new NotFoundError("handler", type);

    if (handler.access && !hasAccess(user, handler.access)) {
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
    const handler = registry.getWriteHandler(type);
    if (!handler) return writeFailure(new NotFoundError("handler", type));

    if (handler.access && !hasAccess(user, handler.access)) {
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

    // Flush afterCommit hooks. Errors are logged, not rethrown: the writes are
    // already committed, we can't undo them.
    const flushAfterCommit = async () => {
      for (const hook of afterCommitHooks) {
        try {
          await hook();
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          const msg = "afterCommit hook failed";
          if (context.log) context.log.error(msg, { error: detail });
          else console.error(`[dispatcher] ${msg}: ${detail}`);
        }
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
