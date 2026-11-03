import type { WriteHandlerDef, WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { SaveContext } from "@cosmicdrift/kumiko-types/hooks";
import type { DbRow, DbRunner, DbTx } from "../db/connection.ts";
import { ConfigScopes } from "../engine/constants.ts";
import { HookPhases } from "../engine/hook-helpers.ts";
import type { HandlerContext, SessionUser } from "../engine/types/index.ts";

import { InternalError, NotFoundError, writeFailure } from "../errors/index.ts";
import { memberResolutionReadOnlyDenied } from "../errors/member-resolution.ts";

import { assertFileRefsBelongToTenant } from "../files/assert-file-refs-belong-to-tenant.ts";
import { bindPendingFileRefs } from "../files/bind-pending-file-refs.ts";
import { disposeRemovedFileRefs } from "../files/dispose-removed-file-refs.ts";
import { loadSaveFileRefs } from "../files/load-save-file-refs.ts";
import { CACHE_SYNC_TOPICS, type TenantConfigSyncMessage } from "../redis/cache-sync-topics.ts";
import { assertNoSecretLeak } from "../secrets/leak-guard.ts";
import type { DispatchContext, WriteOrigin } from "./dispatch-shared.ts";
import {
  buildHandlerContext,
  CONFIG_WRITE_RESET_TYPE,
  CONFIG_WRITE_SET_TYPE,
  isMemberResolutionPrincipal,
  resolveDbSource,
  runHandlerInstrumented,
  TENANT_TIMEZONE_CONFIG_KEY,
} from "./dispatch-shared.ts";
import {
  type AfterCommitHook,
  describeShape,
  isLifecycleResult,
  isWriteResultShape,
  wrapToKumiko,
} from "./dispatcher-utils.ts";
import { perCommandNestedDenied } from "./handler-context-phase-denials.ts";
import { runPreHandlerGates } from "./pre-handler-gates.ts";
import {
  type ConsumedReservation,
  consumeReservation,
  hasPreTransactionPhase,
  nestedPreTransactionDenial,
} from "./pre-transaction-reservations.ts";
import { runProjections } from "./projections-runner.ts";
import { guardAutoTransitions, resolveTransitionGuardDb } from "./write-transition-guard.ts";

// A successful config:write:set/reset returns { key, scope, ... } — see
// bundled-features/src/config/handlers/{set,reset}.write.ts. Narrows the
// otherwise-`unknown` WriteResult.data without an unchecked cast.
function isConfigWriteResult(data: unknown): data is { key: string; scope?: string } {
  if (typeof data !== "object" || data === null || !("key" in data)) return false;
  return typeof data.key === "string";
}

// dispatch-shared.ts caches the resolved tenant:config:timezone
// value per tenant. A successful write to that key must drop the stale
// entry — tenant/user scope only affects the writing tenant, system scope
// changes the fallback every tenant without an override reads, so the
// whole cache is dropped instead of just one entry.
function invalidateTenantTimezoneCache(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  result: WriteResult,
): void {
  // skip: failed write, nothing to invalidate
  if (!result.isSuccess) return;
  // skip: not a config:write:set/reset dispatch
  if (type !== CONFIG_WRITE_SET_TYPE && type !== CONFIG_WRITE_RESET_TYPE) return;
  // skip: write was for a different config key
  if (!isConfigWriteResult(result.data) || result.data.key !== TENANT_TIMEZONE_CONFIG_KEY) return;
  if (result.data.scope === ConfigScopes.system) ctx.tenantTimezoneCache.clear();
  else ctx.tenantTimezoneCache.invalidate(user.tenantId);
}

// Every committed config write tells the other processes (config-derived
// caches such as the tenant timezone and the file provider live per process).
// Only after commit: a pod receiving this earlier would re-read the pre-write
// row and cache the stale value again.
function publishConfigWrite(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  result: WriteResult,
): void {
  // skip: failed write, nothing changed
  if (!result.isSuccess) return;
  // skip: not a config:write:set/reset dispatch
  if (type !== CONFIG_WRITE_SET_TYPE && type !== CONFIG_WRITE_RESET_TYPE) return;
  // skip: result carries no config key to announce
  if (!isConfigWriteResult(result.data)) return;
  const { key, scope } = result.data;
  const message: TenantConfigSyncMessage =
    scope === ConfigScopes.system ? { scope: "all", key } : { tenantId: user.tenantId, key };
  ctx.cacheSync?.publish(CACHE_SYNC_TOPICS.tenantConfig, message);
}

async function settleSaveFileRefs(
  handlerContext: HandlerContext,
  result: SaveContext,
  user: SessionUser,
): Promise<void> {
  const fileRefArgs = { registry: handlerContext.registry, result, user, db: handlerContext.db };
  const fileRefRows = await loadSaveFileRefs(fileRefArgs);
  assertFileRefsBelongToTenant({ ...fileRefArgs, fileRefRows });
  await bindPendingFileRefs({ ...fileRefArgs, fileRefRows });
  await disposeRemovedFileRefs(fileRefArgs);
}

// Runs lifecycle hooks for a handler result. inTransaction hooks fire NOW
// (they see the tx via ctx.db when batch/write opens a transaction).
// afterCommit hooks are queued into `afterCommitHooks` for the caller to
// flush after commit. Their context is built lazily, without `tx`: by the
// time they fire the transaction has already committed, so `handlerContext`
// (built around it) would hand them a dead handle.
async function runLifecycle(
  ctx: DispatchContext,
  type: string,
  data: unknown,
  handlerContext: HandlerContext,
  user: SessionUser,
  origin: WriteOrigin,
  afterCommitHooks: AfterCommitHook[],
  runner: DbRunner | undefined,
): Promise<void> {
  const { lifecycle } = ctx;
  if (!lifecycle) {
    handlerContext.obs.log.debug(`runLifecycle: skipping ${type} — no lifecycle pipeline`);
    return;
  }
  if (!isLifecycleResult(data)) {
    handlerContext.obs.log.debug(`runLifecycle: skipping ${type} — result is not a lifecycle kind`);
    return;
  }
  const result = data;
  const queueAfterCommit = (run: (afterCommitContext: HandlerContext) => Promise<void>): void => {
    afterCommitHooks.push(async () => {
      const afterCommitContext = await buildHandlerContext(ctx, type, user, origin, {
        transactionScope: "postCommit",
      });
      await run(afterCommitContext);
    });
  };

  // Projections run FIRST, inside the tx, before any user postSave/postDelete
  // hooks. If a projection apply() throws, the whole tx rolls back — the
  // event and the auto-projection row go with it. Running before the hooks
  // keeps projection state consistent with what the hooks observe.
  await runProjections(result, handlerContext.registry, runner);

  if (result.kind === "save") {
    await settleSaveFileRefs(handlerContext, result, user);
    await lifecycle.runPostSave(type, result, handlerContext, HookPhases.inTransaction);
    queueAfterCommit((afterCommitContext) =>
      lifecycle.runPostSave(type, result, afterCommitContext, HookPhases.afterCommit),
    );
  } else if (result.kind === "delete") {
    await lifecycle.runPreDelete(type, result, handlerContext);
    await lifecycle.runPostDelete(type, result, handlerContext, HookPhases.inTransaction);
    queueAfterCommit((afterCommitContext) =>
      lifecycle.runPostDelete(type, result, afterCommitContext, HookPhases.afterCommit),
    );
  }
}

// Shared write pipeline: validates, executes handler, runs lifecycle + side effects.
// Used by runBatch (which opens a transaction and flushes afterCommitHooks on commit).
//
// Contract:
//   - `tx` is the active Drizzle transaction handle, or undefined for "no
//     surrounding transaction" — no Postgres is configured.
//   - `afterCommitHooks` collects deferred side-effects that must only fire
//     after the transaction commits. The caller flushes them on commit, drops
//     them on rollback. executeWrite never fires them directly.
export async function executeWrite(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  origin: WriteOrigin,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<WriteResult> {
  return runHandlerInstrumented(ctx, type, "write", user, () =>
    executeWriteInner(ctx, type, payload, user, origin, tx, afterCommitHooks),
  );
}

async function confirmReservation(
  reservation: ConsumedReservation,
  tx: DbTx | undefined,
  user: SessionUser,
): Promise<WriteResult | undefined> {
  if (!reservation.confirmInTransaction) return undefined;
  if (!tx) {
    return writeFailure(
      new InternalError({
        message: "a reservation that settles in the transaction needs a transaction",
      }),
    );
  }
  try {
    await reservation.confirmInTransaction({ tx, tenantId: user.tenantId });
  } catch (e) {
    return writeFailure(wrapToKumiko(e));
  }
  return undefined;
}

type WriteStepFailure = { readonly kind: "failed"; readonly failure: WriteResult };
type ResolvedWriteEntry =
  | WriteStepFailure
  | { readonly kind: "run"; readonly handler: WriteHandlerDef; readonly isPerCommand: boolean };
type PassedWriteGates =
  | WriteStepFailure
  | {
      readonly kind: "run";
      readonly parsedPayload: unknown;
      readonly reservation: ConsumedReservation | undefined;
    };
type RunningWriteGates = Extract<PassedWriteGates, { readonly kind: "run" }>;

function failedStep(failure: WriteResult): WriteStepFailure {
  return { kind: "failed", failure };
}

function resolveWriteEntry(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  tx: DbTx | undefined,
): ResolvedWriteEntry {
  const handler = ctx.registry.getWriteHandler(type);
  if (!handler) return failedStep(writeFailure(new NotFoundError("handler", type)));

  // Defense in depth — covers runBatch and a spread-copied user that kept
  // `origin`, beyond buildHandlerContext's own ctx.dispatch.write replacement.
  if (isMemberResolutionPrincipal(user)) {
    return failedStep(writeFailure(memberResolutionReadOnlyDenied()));
  }

  const isPerCommand = handler.transaction === "perCommand";
  if (isPerCommand && tx !== undefined) {
    return failedStep(writeFailure(perCommandNestedDenied(type)));
  }
  return { kind: "run", handler, isPerCommand };
}

async function runWriteGates(
  ctx: DispatchContext,
  handler: WriteHandlerDef,
  type: string,
  payload: unknown,
  user: SessionUser,
): Promise<PassedWriteGates> {
  // A command the dispatcher ran pre-transaction phases for was already billed against the rate
  // limits; the gates only run again against the in-transaction state.
  const needsPreTransactionPhase = hasPreTransactionPhase(handler);
  const reservation = needsPreTransactionPhase ? consumeReservation(type) : undefined;
  const gates = await runPreHandlerGates(
    ctx,
    handler,
    type,
    payload,
    user,
    reservation ? "recheck" : "charge",
  );
  if (!gates.isSuccess) return failedStep(gates);
  const parsedPayload = reservation ? reservation.parsedPayload : gates.payload;

  const nestedDenial = reservation ? undefined : nestedPreTransactionDenial(handler, type);
  if (nestedDenial) return failedStep(nestedDenial);
  return { kind: "run", parsedPayload, reservation };
}

// The handler itself plus the lifecycle pipeline run under the same
// try-wrapper: any KumikoError bubbles up as a typed WriteErrorInfo, any
// other throw gets wrapped in InternalError so the Prod contract holds
// ("unexpected throw → 500 with sanitized body"). We intentionally do NOT
// catch further out (runBatch still sees these as exceptions via
// writeFailure, not via a rethrow) so batches roll back naturally.
async function invokeWriteHandler(
  handler: WriteHandlerDef,
  type: string,
  gated: RunningWriteGates,
  user: SessionUser,
  handlerContext: HandlerContext,
): Promise<WriteResult> {
  let result: WriteResult;
  try {
    const event = {
      type,
      payload: gated.parsedPayload,
      user,
      prepared: gated.reservation?.prepared,
    };
    result = await handler.handler(event, handlerContext);
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
  return result;
}

type SettleWriteArgs = {
  readonly type: string;
  readonly user: SessionUser;
  readonly origin: WriteOrigin;
  readonly tx: DbTx | undefined;
  readonly afterCommitHooks: AfterCommitHook[];
  readonly parsedPayload: unknown;
  readonly reservation: ConsumedReservation | undefined;
  readonly isPerCommand: boolean;
  readonly handlerContext: HandlerContext;
  readonly result: Extract<WriteResult, { readonly isSuccess: true }>;
};

async function runWriteLifecycle(
  ctx: DispatchContext,
  args: SettleWriteArgs,
): Promise<WriteResult | undefined> {
  try {
    const runner = resolveDbSource(ctx, args.tx);
    await runLifecycle(
      ctx,
      args.type,
      args.result.lifecycle ?? args.result.data,
      args.handlerContext,
      args.user,
      args.origin,
      args.afterCommitHooks,
      runner,
    );
  } catch (e) {
    return writeFailure(wrapToKumiko(e));
  }
  return undefined;
}

function scheduleWriteAfterCommit(
  ctx: DispatchContext,
  type: string,
  user: SessionUser,
  parsedPayload: unknown,
  result: WriteResult,
  afterCommitHooks: AfterCommitHook[],
): void {
  const { jobRunner } = ctx;
  // jobRunner has external side-effects (BullMQ enqueue) — must NOT
  // fire for rolled-back writes. Defer to afterCommit.
  if (jobRunner) {
    const eventData = (parsedPayload ?? {}) as DbRow; // @cast-boundary engine-payload
    afterCommitHooks.push(() => jobRunner.handleEvent(type, eventData, user));
  }

  invalidateTenantTimezoneCache(ctx, type, user, result);
  // Again after commit: a query landing between the drop above and the
  // commit would read the pre-write row (tx not yet visible) and
  // repopulate the cache with the stale value for a full TTL.
  afterCommitHooks.push(async () => {
    invalidateTenantTimezoneCache(ctx, type, user, result);
    publishConfigWrite(ctx, type, user, result);
  });
}

async function settleSuccessfulWrite(
  ctx: DispatchContext,
  args: SettleWriteArgs,
): Promise<WriteResult | undefined> {
  if (args.reservation) {
    const confirmFailure = await confirmReservation(args.reservation, args.tx, args.user);
    if (confirmFailure) return confirmFailure;
  }

  // A perCommand handler's writes ran as their own commands; its result carries no SaveContext of its own to project.
  if (!args.isPerCommand) {
    const lifecycleFailure = await runWriteLifecycle(ctx, args);
    if (lifecycleFailure) return lifecycleFailure;
  }

  scheduleWriteAfterCommit(
    ctx,
    args.type,
    args.user,
    args.parsedPayload,
    args.result,
    args.afterCommitHooks,
  );
  return undefined;
}

async function executeWriteInner(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  origin: WriteOrigin,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<WriteResult> {
  const entry = resolveWriteEntry(ctx, type, user, tx);
  if (entry.kind === "failed") return entry.failure;
  const { handler, isPerCommand } = entry;

  const gated = await runWriteGates(ctx, handler, type, payload, user);
  if (gated.kind === "failed") return gated.failure;

  // Without a database there is no transaction either, but ordinary handlers keep the in-transaction nested-write semantics.
  const handlerContext = await buildHandlerContext(ctx, type, user, origin, {
    tx,
    afterCommitHooks,
    transactionScope: isPerCommand ? "withoutTransaction" : "inTransaction",
  });

  const transitionGuardDb = resolveTransitionGuardDb(handlerContext, type);
  await guardAutoTransitions(ctx, handler, type, gated.parsedPayload, transitionGuardDb, tx);

  const result = await invokeWriteHandler(handler, type, gated, user, handlerContext);
  if (!result.isSuccess) return result;

  const settleFailure = await settleSuccessfulWrite(ctx, {
    type,
    user,
    origin,
    tx,
    afterCommitHooks,
    parsedPayload: gated.parsedPayload,
    reservation: gated.reservation,
    isPerCommand,
    handlerContext,
    result,
  });
  if (settleFailure) return settleFailure;

  // Response-guard: block Secret<> leaks in write responses (SaveContext
  // data / previous / changes). Feature code that fed a plaintext through
  // to the return payload fails here instead of hitting the client.
  assertNoSecretLeak(result.data);
  assertNoSecretLeak(result.lifecycle);
  return result;
}
