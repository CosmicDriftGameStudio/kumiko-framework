import { runWithWriteOrigin } from "../api/request-context.ts";
import type { DbTx } from "../db/connection.ts";
import { runInSavepoint } from "../db/query.ts";
import type { HandlerDispatch, SessionUser, WriteResult } from "../engine/types/index.ts";
import { writeFailure } from "../errors/index.ts";
import {
  type AfterRollbackHook,
  afterRollbackHooksOf,
  carrySavepointRollbackHooks,
} from "./after-rollback-sink.ts";
import { runBatch, unwrapSingle } from "./dispatch-batch.ts";
import { executeQuery } from "./dispatch-query.ts";
import type { HandlerTransactionScope } from "./dispatch-shared.ts";
import { executeWrite } from "./dispatch-write.ts";
import {
  type AfterCommitHook,
  isFailedWriteResult,
  NestedWriteRollback,
} from "./dispatcher-utils.ts";
import { perCommandNestedDenied } from "./handler-context-phase-denials.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { createGatedIdentitySwitch } from "./system-identity-switch.ts";

export type CommitSinks = {
  readonly bridgeSink: AfterCommitHook[];
  readonly hasLiveCommitSink: boolean;
  readonly notifyCommitSink: AfterCommitHook[] | undefined;
};

export function createCommitSinks(
  afterCommitHooks: AfterCommitHook[] | undefined,
  transactionScope: HandlerTransactionScope,
  outerNotifySink: AfterCommitHook[] | undefined,
): CommitSinks {
  // Cross-feature bridge: ctx.dispatch.query/write share the current tx + afterCommitHooks sink.
  // queryAs/writeAs to anyone but the caller itself needs r.systemScope() or { escapeHatch } (system-identity-switch.ts).
  const bridgeSink = afterCommitHooks ?? [];
  // Query bridges and post-commit contexts get a throwaway sink: hooks pushed there never run.
  const hasLiveCommitSink = afterCommitHooks !== undefined && transactionScope !== "postCommit";
  return {
    bridgeSink,
    hasLiveCommitSink,
    notifyCommitSink: hasLiveCommitSink ? bridgeSink : outerNotifySink,
  };
}

// A failed inner write has already appended its event and projections when a later
// step (e.g. an inTransaction hook) fails, and the outer handler may swallow the
// failure result. The savepoint makes the failure undo exactly the inner write; the
// inner afterCommit hooks only reach the outer sink if it succeeded.
async function runNestedWriteInSavepoint(
  scope: HandlerContextScope,
  sinks: CommitSinks,
  asUser: SessionUser,
  targetType: string,
  payload: unknown,
): Promise<WriteResult> {
  const { ctx, registry, origin, tx } = scope;
  const { bridgeSink } = sinks;
  if (registry.getWriteHandler(targetType)?.transaction === "perCommand") {
    return writeFailure(perCommandNestedDenied(targetType));
  }
  if (!tx) return executeWrite(ctx, targetType, payload, asUser, origin, tx, bridgeSink);
  const innerAfterCommitHooks: AfterCommitHook[] = [];
  try {
    const result = await runInSavepoint(tx, async (savepointTx) => {
      const innerResult = await executeWrite(
        ctx,
        targetType,
        payload,
        asUser,
        origin,
        savepointTx as DbTx, // @cast-boundary db-runner savepoint handle is a transaction handle
        innerAfterCommitHooks,
      );
      if (isFailedWriteResult(innerResult)) throw new NestedWriteRollback(innerResult);
      return innerResult;
    });
    bridgeSink.push(...innerAfterCommitHooks);
    carrySavepointRollbackHooks(innerAfterCommitHooks, bridgeSink, false);
    return result;
  } catch (e) {
    carrySavepointRollbackHooks(innerAfterCommitHooks, bridgeSink, true);
    if (e instanceof NestedWriteRollback) return e.failure;
    throw e;
  }
}

// Savepoints on one connection are not serialized by the driver: two parallel nested writes would
// interleave their statements and a ROLLBACK TO of the first would also discard the second's rows.
// Writes nested one level deeper run on their own savepoint handle and therefore their own chain.
function createSerializedNestedWriter(scope: HandlerContextScope, sinks: CommitSinks) {
  let nestedWriteChain: Promise<unknown> = Promise.resolve();
  return (asUser: SessionUser, targetType: string, payload: unknown): Promise<WriteResult> => {
    const run = nestedWriteChain.then(() =>
      runNestedWriteInSavepoint(scope, sinks, asUser, targetType, payload),
    );
    nestedWriteChain = run.catch(() => undefined);
    return run;
  };
}

export type DispatchFacetInput = Pick<HandlerDispatch, "queryAsMember" | "queryProjection">;

export function buildDispatchFacet(
  scope: HandlerContextScope,
  sinks: CommitSinks,
  readers: DispatchFacetInput,
) {
  const {
    ctx,
    type,
    user,
    origin,
    tx,
    transactionScope,
    hasIdentitySwitchGrant,
    identitySwitchAudit,
  } = scope;
  const scheduleAfterCommit = (hook: AfterCommitHook): void => {
    sinks.bridgeSink.push(hook);
  };
  const scheduleAfterRollback = (hook: AfterRollbackHook): void => {
    afterRollbackHooksOf(sinks.bridgeSink).push(() => runWithWriteOrigin(origin, hook));
  };
  const executeNestedWriteInSavepoint = createSerializedNestedWriter(scope, sinks);
  // Without an open transaction (post-commit hooks, stream/query handlers, perCommand handlers) a bare
  // executeWrite would auto-commit event append, projections and inTransaction hooks separately and its
  // afterCommit hooks would land in a sink nobody flushes. A batch-of-one gives the write its own
  // transaction and its own flush.
  const writeAsUser = async (asUser: SessionUser, targetType: string, payload: unknown) =>
    transactionScope === "inTransaction"
      ? executeNestedWriteInSavepoint(asUser, targetType, payload)
      : unwrapSingle(
          await runBatch(ctx, [{ type: targetType, payload }], asUser, undefined, origin),
        );
  const identitySwitch = createGatedIdentitySwitch(
    `handler "${type}"`,
    user,
    hasIdentitySwitchGrant,
    {
      // Inherits the caller's origin, so switching to SYSTEM cannot shed an anonymous root.
      queryAs: (asUser: SessionUser, targetType: string, payload: unknown) =>
        executeQuery(ctx, targetType, payload, asUser, origin, tx, sinks.notifyCommitSink), // @wrapper-known semantic-alias
      writeAs: writeAsUser,
    },
    identitySwitchAudit,
  );
  return {
    dispatch: {
      ...readers,
      query: (targetType: string, payload: unknown) =>
        executeQuery(ctx, targetType, payload, user, origin, tx, sinks.notifyCommitSink), // @wrapper-known semantic-alias
      queryAs: identitySwitch.queryAs,
      write: (targetType: string, payload: unknown) => writeAsUser(user, targetType, payload),
      writeAs: identitySwitch.writeAs,
    } satisfies HandlerDispatch,
    scheduleFragment: {
      ...(sinks.hasLiveCommitSink && { scheduleAfterCommit }),
      // perCommand and no-tx paths have earlier commands already committed: nothing to compensate on rollback.
      ...(sinks.hasLiveCommitSink &&
        transactionScope === "inTransaction" && { scheduleAfterRollback }),
    },
  };
}
