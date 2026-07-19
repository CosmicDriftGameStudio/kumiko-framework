import type { DbConnection } from "../db/connection";
import { transaction } from "../db/query";
import type { DeleteContext, SaveContext, SessionUser, WriteResult } from "../engine/types";
import { InternalError, toWriteErrorInfo, writeFailure } from "../errors";
import { createFallbackLogger } from "../logging/utils";
import { parseJsonSafe } from "../utils/safe-json";
import type { BatchCommand, BatchResult, DispatchContext } from "./dispatch-shared";
import { resolveDbSource } from "./dispatch-shared";
import { executeNestedWrite } from "./dispatch-write";
import {
  type AfterCommitHook,
  BatchRollback,
  isLifecycleResult,
  wrapToKumiko,
} from "./dispatcher-utils";

// Core batch logic extracted so write() and command() can reuse it
// (a single write = batch of one, running in its own transaction).
export async function runBatch(
  ctx: DispatchContext,
  commands: readonly BatchCommand[],
  user: SessionUser,
  requestId?: string,
): Promise<BatchResult> {
  const { idempotency, lifecycle, appContext: context } = ctx;
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
      const logError = createFallbackLogger("dispatcher", context.log);
      logError.error("batch hook flush failed", { error: e });
    }
  };

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
      const res = await executeNestedWrite(
        ctx,
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
    await transaction(db, async (tx) => {
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (!cmd) continue;
        const res = await executeNestedWrite(
          ctx,
          cmd.type,
          cmd.payload,
          user,
          tx,
          afterCommitHooks,
        );
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
