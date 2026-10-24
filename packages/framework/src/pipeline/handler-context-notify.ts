import type { DbConnection } from "../db/connection.ts";
import type { TenantId } from "../engine/types/identifiers.ts";
import type { NotifyFn, NotifyJobDispatcher, SessionUser } from "../engine/types/index.ts";
import type { CommitSinks } from "./handler-context-dispatch.ts";
import type { HandlerContextScope } from "./handler-context-scope.ts";
import { createDeferringNotify } from "./notify-scope.ts";

type NotifyFactory = (notifyUser: SessionUser, notifyTenantId: TenantId) => NotifyFn;

// DispatchContext.jobRunner is typed as the handleEvent-only JobRunnerRef but
// holds the concrete runner at boot; narrow instead of casting.
function isNotifyJobDispatcher(runner: unknown): runner is NotifyJobDispatcher {
  return (
    typeof runner === "object" &&
    runner !== null &&
    "dispatch" in runner &&
    typeof runner.dispatch === "function"
  );
}

function buildNotify(
  scope: HandlerContextScope,
  sinks: CommitSinks,
  notifyAfterCommitFactory: NotifyFactory | undefined,
  notifyInTransactionFactory: NotifyFactory | undefined,
): NotifyFn | undefined {
  const { user, registry } = scope;
  if (!notifyAfterCommitFactory) return undefined;
  const notifyAfterCommit = notifyAfterCommitFactory(user, user.tenantId);
  if (!notifyInTransactionFactory) return notifyAfterCommit;
  const notifyInTransaction = notifyInTransactionFactory(user, user.tenantId);
  // A rolled-back write must leave no notification behind. Without any commit to wait for (a
  // post-commit context) delivery stays immediate.
  const { notifyCommitSink } = sinks;
  if (notifyCommitSink === undefined) return notifyInTransaction;
  return createDeferringNotify({
    registry,
    tenantId: user.tenantId,
    notifyAfterCommit,
    notifyNow: notifyInTransaction,
    scheduleAfterCommit: (hook) => {
      notifyCommitSink.push(hook);
    },
  });
}

export function buildNotifyFacet(
  scope: HandlerContextScope,
  sinks: CommitSinks,
  outsideTxSource: DbConnection | undefined,
) {
  const { ctx, tx, context } = scope;
  const notifyFactory = context._notifyFactory;
  const notifyJobDispatcher = isNotifyJobDispatcher(ctx.jobRunner) ? ctx.jobRunner : undefined;
  // Inside the write tx the app pool's slots can all be held by waiting write txs, so the
  // delivery's own DB work (broadcast lookup, attempt log, channel sends) runs on the outside-tx pool.
  const notifyInTransactionFactory =
    notifyFactory && tx !== undefined
      ? (notifyUser: SessionUser, notifyTenantId: TenantId): NotifyFn =>
          notifyFactory(
            notifyUser,
            notifyTenantId,
            notifyJobDispatcher,
            outsideTxSource,
            context._fileProviderResolver,
          )
      : undefined;
  const notifyAfterCommitFactory = notifyFactory
    ? (notifyUser: SessionUser, notifyTenantId: TenantId): NotifyFn =>
        notifyFactory(
          notifyUser,
          notifyTenantId,
          notifyJobDispatcher,
          undefined,
          context._fileProviderResolver,
        )
    : undefined;
  const notify = buildNotify(scope, sinks, notifyAfterCommitFactory, notifyInTransactionFactory);
  return {
    notify,
    factoryServices: {
      ...(notifyInTransactionFactory && {
        _notifyInTransactionFactory: notifyInTransactionFactory,
      }),
      ...(notifyAfterCommitFactory && { _notifyAfterCommitFactory: notifyAfterCommitFactory }),
    },
  };
}
