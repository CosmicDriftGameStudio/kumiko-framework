import type { JobRunnerRef } from "@cosmicdrift/kumiko-types/handlers";
import type { HandlerContext } from "../engine/types/index.ts";

import { InternalError } from "../errors/index.ts";
import { memberResolutionReadOnlyDenied } from "../errors/member-resolution.ts";

import { attachOutsideTransaction } from "./attach-outside-transaction.ts";

// Phase denials of the write pipeline: member-resolution, without-transaction and the two
// pre-transaction phases each strip a different set of ctx surfaces.

// JobRunnerRef's declared type only carries handleEvent, but callers
// routinely bracket-access a fuller runner — a Proxy denies ANY property read.
export function denyingJobRunnerProxy(
  denied: () => Error = memberResolutionReadOnlyDenied,
): JobRunnerRef {
  const target: JobRunnerRef = {
    handleEvent: async () => {
      throw denied();
    },
  };
  return new Proxy(target, {
    get() {
      throw denied();
    },
  });
}

export function dropOutsideTransaction(handlerContext: HandlerContext): void {
  if (handlerContext.db) attachOutsideTransaction(handlerContext.db, undefined);
}

function beforeTransactionDenied(surface: string): InternalError {
  return new InternalError({
    message: `ctx.${surface} is not available before the transaction; move it into the handler`,
  });
}

export function withoutTransactionDenied(surface: string): InternalError {
  return new InternalError({
    message: `ctx.${surface} is not available without an open transaction; run the write through ctx.dispatch.write so it gets its own transaction`,
  });
}

export function perCommandNestedDenied(targetType: string): InternalError {
  return new InternalError({
    message: `handler "${targetType}" runs without a transaction (transaction: "perCommand") and cannot run as a nested write inside an open transaction`,
  });
}

function denySurface(buildError: (surface: string) => InternalError, surface: string): () => never {
  return () => {
    throw buildError(surface);
  };
}

export function denyEventStoreSurfaces(
  handlerContext: HandlerContext,
  buildError: (surface: string) => InternalError,
): HandlerContext {
  const deny = (surface: string) => denySurface(buildError, `events.${surface}`);
  return {
    ...handlerContext,
    events: {
      ...handlerContext.events,
      append: deny("append"),
      unsafeAppend: deny("unsafeAppend"),
      tryAppend: deny("tryAppend"),
      fetchForWriting: deny("fetchForWriting"),
      archive: deny("archive"),
      restore: deny("restore"),
      snapshot: deny("snapshot"),
    },
  };
}

// Reservations write on purpose through the outside-transaction handles, so they keep those but
// lose every surface bound to the not-yet-open transaction.
export function denyTransactionBoundSurfaces(handlerContext: HandlerContext): HandlerContext {
  const { lifecycle, services } = handlerContext;
  return {
    ...denyEventStoreSurfaces(handlerContext, beforeTransactionDenied),
    dispatch: {
      ...handlerContext.dispatch,
      write: denySurface(beforeTransactionDenied, "dispatch.write"),
      writeAs: denySurface(beforeTransactionDenied, "dispatch.writeAs"),
    },
    lifecycle: {
      ...lifecycle,
      afterCommit: denySurface(beforeTransactionDenied, "lifecycle.afterCommit"),
      afterRollback: denySurface(beforeTransactionDenied, "lifecycle.afterRollback"),
    },
    ...(handlerContext.notify && { notify: denySurface(beforeTransactionDenied, "notify") }),
    services: {
      ...withoutNotifyFactories(services),
      ...(services.jobRunner && {
        jobRunner: denyingJobRunnerProxy(() => beforeTransactionDenied("services.jobRunner")),
      }),
    },
  };
}

// A notify factory builds a working notify, so a phase that denies ctx.notify must drop them too.
export function withoutNotifyFactories(
  services: HandlerContext["services"],
): HandlerContext["services"] {
  const {
    _notifyFactory: _factory,
    _notifyInTransactionFactory: _inTransaction,
    _notifyAfterCommitFactory: _afterCommit,
    ...rest
  } = services;
  return rest;
}

// The beforeTransaction phase has no write need at all, so it also loses the outside-transaction
// handles. systemDb is mutated in place like db: its identity keys the unsafeRaw rebinders, so a
// spread or proxy would lose them. It is built per call, so no other context shares it.
export function applyBeforeTransactionReadOnly(handlerContext: HandlerContext): HandlerContext {
  dropOutsideTransaction(handlerContext);
  if (handlerContext.systemDb) attachOutsideTransaction(handlerContext.systemDb, undefined);
  return denyTransactionBoundSurfaces(handlerContext);
}
