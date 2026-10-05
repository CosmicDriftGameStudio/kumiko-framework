import type { WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import { requestContext, runWithWriteOrigin } from "../api/request-context.js";
import type { DbConnection } from "../db/connection.js";
import { transaction } from "../db/query.js";
import type {
  DeleteContext,
  SaveContext,
  SessionUser,
  WriteResult,
} from "../engine/types/index.js";
import { InternalError, toWriteErrorInfo, writeFailure } from "../errors/index.js";
import { createFallbackLogger } from "../logging/utils.js";
import { parseJsonSafe } from "../utils/safe-json.js";
import type { BatchCommand, BatchResult, DispatchContext } from "./dispatch-shared.js";
import { resolveDbSource } from "./dispatch-shared.js";
import { executeNestedWrite } from "./dispatch-write.js";
import {
  type AfterCommitHook,
  BatchRollback,
  isLifecycleResult,
  wrapToKumiko,
} from "./dispatcher-utils.js";
import {
  type PreTransactionReservations,
  reserveBeforeTransaction,
  runAsCommand,
} from "./pre-transaction-reservations.js";
import { effectiveWriteOrigin, isPersonalDataGated, rootWriteOrigin } from "./write-origin.js";
import { maskBatchResultForClient } from "./write-result-masking.js";

// afterCommit hooks fire in flushAfterCommit, outside the command's scope.
function rewrapHooksWithOrigin(
  afterCommitHooks: AfterCommitHook[],
  fromIndex: number,
  origin: WriteOrigin,
): void {
  for (let i = fromIndex; i < afterCommitHooks.length; i++) {
    const original = afterCommitHooks[i];
    if (!original) continue;
    afterCommitHooks[i] = () => runWithWriteOrigin(origin, original);
  }
}

type ReservedCommandScope = {
  readonly ctx: DispatchContext;
  readonly user: SessionUser;
  readonly inheritedOrigin: WriteOrigin | undefined;
  readonly reservations: Extract<PreTransactionReservations, { isSuccess: true }>;
  readonly origins: WriteOrigin[];
  readonly afterCommitHooks: AfterCommitHook[];
};

function toReservedScope(
  reservations: Extract<PreTransactionReservations, { isSuccess: true }>,
  index: number,
  cmd: BatchCommand,
) {
  const reservation = reservations.reservedCommands.get(index);
  return reservation && { type: cmd.type, reservation };
}

async function runReservedCommand(
  scope: ReservedCommandScope,
  cmd: BatchCommand,
  index: number,
  tx: Parameters<typeof executeNestedWrite>[5],
): Promise<WriteResult> {
  const { ctx, user, inheritedOrigin, reservations, origins, afterCommitHooks } = scope;
  const origin = effectiveWriteOrigin(
    rootWriteOrigin(ctx.registry, cmd.type, user),
    inheritedOrigin,
  );
  origins.push(origin);
  const hookStart = afterCommitHooks.length;
  const res = await runAsCommand(toReservedScope(reservations, index, cmd), () =>
    runWithWriteOrigin(origin, () =>
      executeNestedWrite(ctx, cmd.type, cmd.payload, user, origin, tx, afterCommitHooks),
    ),
  );
  rewrapHooksWithOrigin(afterCommitHooks, hookStart, origin);
  return res;
}

// Core batch logic extracted so write() and command() can reuse it
// (a single write = batch of one, running in its own transaction).
export async function runBatch(
  ctx: DispatchContext,
  commands: readonly BatchCommand[],
  user: SessionUser,
  requestId?: string,
  inheritedOrigin?: WriteOrigin,
): Promise<BatchResult> {
  const current = requestContext.get();
  if (!current?.signal) {
    return runBatchBody(ctx, commands, user, requestId, inheritedOrigin);
  }
  // Strip the signal: a client disconnect must not roll back a write whose
  // afterCommit effects would then be lost.
  const { signal: _signal, ...withoutSignal } = current;
  return requestContext.run(withoutSignal, () =>
    runBatchBody(ctx, commands, user, requestId, inheritedOrigin),
  );
}

async function runBatchBody(
  ctx: DispatchContext,
  commands: readonly BatchCommand[],
  user: SessionUser,
  requestId?: string,
  inheritedOrigin?: WriteOrigin,
): Promise<BatchResult> {
  const { idempotency, lifecycle, appContext: context } = ctx;
  if (commands.length === 0) {
    return { isSuccess: true, results: [] };
  }

  // Idempotency: if the same requestId has already been processed, return the
  // cached result without re-executing. The cache holds the full BatchResult.
  // idempotencyToken is only set when we actually acquired the lock — the
  // corrupted-cache fallthrough below leaves it unset, so finalize() skips
  // store() rather than writing over an entry it never owned.
  let idempotencyToken: string | undefined;
  if (requestId && idempotency) {
    const checked = await idempotency.check(user.tenantId, user.id, requestId);
    if (checked.status === "cached") {
      const parsed = parseJsonSafe<BatchResult | null>(checked.result, null);
      if (parsed) return parsed;
      // corrupted cache entry — treat as miss, let the request re-run
    } else {
      idempotencyToken = checked.token;
    }
  }

  // Hooks already ran on the plaintext results; what is returned and cached
  // for retries must not carry writeOnly values.
  const maskForClient = (result: BatchResult): BatchResult =>
    maskBatchResultForClient(ctx.registry, commands, result);

  // Cache the result under requestId so retries get the same answer. Only a
  // provably rolled-back 5xx releases the lock instead (releaseOrFinalize).
  const finalize = async (result: BatchResult): Promise<BatchResult> => {
    const masked = maskForClient(result);
    if (requestId && idempotency && idempotencyToken) {
      await idempotency.store(user.tenantId, user.id, requestId, idempotencyToken, masked);
    }
    return masked;
  };

  // Never for the no-tx fallback: without a rollback, a re-run would repeat
  // the side effects of the commands that already ran.
  const releaseOrFinalize = async (
    result: BatchResult,
    isRetryableRollback: boolean,
  ): Promise<BatchResult> => {
    if (isRetryableRollback && requestId && idempotency && idempotencyToken) {
      await idempotency.release(user.tenantId, user.id, requestId, idempotencyToken);
      return maskForClient(result);
    }
    return finalize(result);
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
    const logError = createFallbackLogger("dispatcher", context.log);
    const outcomes = await Promise.allSettled(afterCommitHooks.map((hook) => hook()));
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        const detail =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        logError.error("afterCommit hook failed", { error: detail });
      }
    }
  };

  const origins: WriteOrigin[] = [];

  // Fires the batch-level system hooks with every successful save/delete
  // context from this run. Called after flushAfterCommit so per-save hooks
  // have all completed first; errors are isolated inside lifecycleHooks.
  const flushBatchHooksInner = async () => {
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
      const logError = createFallbackLogger("dispatcher", context.log);
      logError.error("batch hook flush failed", { error: e });
    }
  };

  // Batch hooks see every command's saves, so they run under the strictest origin.
  const flushBatchHooks = async () => {
    const strictest = origins.find(isPersonalDataGated) ?? origins[0];
    // skip: no command ran, so batch hooks have no saves or deletes to see
    if (!strictest) return;
    await runWithWriteOrigin(strictest, flushBatchHooksInner);
  };

  // Reserve before the transaction opens so no extra connection is held while the handler tx is
  // open; the release below runs only after that tx has ended without committing.
  const reservations = await reserveBeforeTransaction(ctx, commands, user, inheritedOrigin);
  if (!reservations.isSuccess) {
    return releaseOrFinalize(
      {
        isSuccess: false,
        error: reservations.error,
        failedIndex: reservations.failedIndex,
        results,
      },
      reservations.error.httpStatus >= 500,
    );
  }

  // batch() opens its own outer transaction — needs the top-level
  // connection's `.begin()` (TransactionSql exposes only `.savepoint()`).
  const db = resolveDbSource(ctx, undefined) as DbConnection | undefined;
  if (!db) {
    // Without a DB connection there is no transaction to open. Fall back to
    // sequential execution — useful for unit tests that don't touch the DB.
    // Each command runs independently; a failure stops the batch.
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (!cmd) continue;
      const res = await runReservedCommand(
        { ctx, user, inheritedOrigin, reservations, origins, afterCommitHooks },
        cmd,
        i,
        undefined,
      );
      results.push(res);
      if (!res.isSuccess) {
        // No tx means no rollback — but we still drop afterCommit hooks,
        // matching the semantic "failure = side-effects don't fire".
        await reservations.releaseAll();
        return finalize({ isSuccess: false, error: res.error, failedIndex: i, results });
      }
    }
    await flushAfterCommit();
    await flushBatchHooks();
    return finalize({ isSuccess: true, results });
  }

  let transactionCallbackCompleted = false;
  try {
    await transaction(db, async (tx) => {
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (!cmd) continue;
        const res = await runReservedCommand(
          { ctx, user, inheritedOrigin, reservations, origins, afterCommitHooks },
          cmd,
          i,
          tx,
        );
        results.push(res);
        if (!res.isSuccess) {
          throw new BatchRollback(i, res.error);
        }
      }
      transactionCallbackCompleted = true;
    });
  } catch (e) {
    // Rollback or failed COMMIT: the transaction is over, so the reserved capacity goes back.
    await reservations.releaseAll();
    if (e instanceof BatchRollback) {
      // Thrown inside the callback, so the tx rolled back. A 4xx is
      // deterministic and stays cached; a 5xx may be transient.
      return releaseOrFinalize(
        {
          isSuccess: false,
          error: e.failureError,
          failedIndex: e.failedIndex,
          results,
        },
        e.failureError.httpStatus >= 500,
      );
    }
    // A completed callback means the throw came from COMMIT (outcome unknown),
    // so cache it; otherwise COMMIT was never sent and releasing is safe.
    const error = toWriteErrorInfo(wrapToKumiko(e));
    return releaseOrFinalize(
      {
        isSuccess: false,
        error,
        failedIndex: results.length,
        results,
      },
      !transactionCallbackCompleted && error.httpStatus >= 500,
    );
  }

  // Commit succeeded — fire deferred side-effects.
  await flushAfterCommit();
  await flushBatchHooks();
  return finalize({ isSuccess: true, results });
}

// Unwrap a BatchResult into a single WriteResult for write()/command().
// Picks the first result on success (the only one for a single write), the
// failing one on failure. Falls back to a synthetic error if the batch
// didn't produce any results (unexpected).
export function unwrapSingle(batchResult: BatchResult): WriteResult {
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
