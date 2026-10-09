import { accessInvalidationCredentialFor } from "../api/sse-broker.js";
import { scheduleTokenExpiry } from "../api/token-expiry-timer.js";
import { hasAccess } from "../engine/access.js";
import type { SessionUser } from "../engine/types/index.js";
import {
  AccessDeniedError,
  memberResolutionReadOnlyDenied,
  NotFoundError,
  validationErrorFromZod,
} from "../errors/index.js";
import { assertNoSecretLeak } from "../secrets/index.js";
import {
  buildHandlerContext,
  type DispatchContext,
  enforceRateLimit,
  ensureFeatureEnabled,
  isMemberResolutionPrincipal,
  runStreamInstrumented,
  type WriteOrigin,
} from "./dispatch-shared.js";
import { handlerAccessError } from "./handler-access-error.js";

export type StreamOptions = {
  /** JWT exp (epoch seconds) the stream was opened with; the stream ends when it passes. */
  readonly tokenExpiresAtSec?: number | undefined;
};

// Standalone stream execution — used by the public dispatcher.stream().
// Chunk-by-chunk analog of executeQuery: same gate order (feature → rate-
// limit → access → validation → handler), but yields incrementally instead
// of returning a single response. streamHandler never entity-maps (unlike
// write/queryHandler — see feature-entity-handlers.ts), so there's no
// field-access filter or postQuery-hook stage to run here.
export async function* executeStream(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  origin: WriteOrigin,
  options?: StreamOptions,
): AsyncGenerator<unknown> {
  yield* runStreamInstrumented(ctx, type, user, () =>
    executeStreamInner(ctx, type, payload, user, origin, options),
  );
}

async function* executeStreamInner(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  origin: WriteOrigin,
  options: StreamOptions | undefined,
): AsyncGenerator<unknown> {
  const { registry } = ctx;
  const handler = registry.getStreamHandler(type);
  if (!handler) throw new NotFoundError("handler", type);

  // A resolved member principal (ctx.queryAsMember) is read-only — streams
  // are excluded the same way executeWriteInner excludes writes.
  if (isMemberResolutionPrincipal(user)) {
    throw memberResolutionReadOnlyDenied();
  }

  await ensureFeatureEnabled(ctx, type, user.tenantId);

  await enforceRateLimit(ctx, handler.rateLimit, type, user, registry.isHandlerSystemScoped(type));

  if (!hasAccess(user, handler.access)) {
    throw handlerAccessError(user, type);
  }

  const parsed = handler.schema.safeParse(payload);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }

  // Idle (heartbeat-only) streams must also cut on access revoke or token expiry — race each
  // pull against an ended Deferred instead of a post-chunk boolean.
  let resolveEnded: ((reason: "revoked" | "expired") => void) | undefined;
  const ended = new Promise<"revoked" | "expired">((resolve) => {
    resolveEnded = resolve;
  });
  const unsubscribeAccessInvalidation = ctx.sseBroker?.subscribeAccessInvalidation(
    user.id,
    () => {
      resolveEnded?.("revoked");
    },
    accessInvalidationCredentialFor(user),
  );
  const expiryTimer = scheduleTokenExpiry(options?.tokenExpiresAtSec, () => {
    resolveEnded?.("expired");
  });

  let iterator: AsyncIterator<unknown> | undefined;
  // When access is revoked mid-pull, `iterator.next()` is still in flight.
  // Awaiting `iterator.return()` in that state deadlocks async generators in
  // Bun (overlapping next+return). Track abandonment so finally skips the
  // await; close is fire-and-forget instead (#1563).
  let abandonedForInvalidation = false;
  try {
    const handlerContext = await buildHandlerContext(ctx, type, user, origin);
    const chunks = handler.handler({ type, payload: parsed.data, user }, handlerContext);
    iterator = chunks[Symbol.asyncIterator]();

    while (true) {
      const nextPull = iterator.next();
      const outcome = await Promise.race([
        nextPull.then((result) => ({ kind: "chunk" as const, result })),
        ended.then((reason) => ({ kind: "ended" as const, reason })),
      ]);
      if (outcome.kind === "ended") {
        abandonedForInvalidation = true;
        void nextPull.catch(() => {});
        void iterator.return?.(undefined)?.then(undefined, () => {});
        throw new AccessDeniedError({
          message:
            outcome.reason === "expired"
              ? `token expired mid-stream for ${type}`
              : `access revoked mid-stream for ${type}`,
          details: { handler: type },
        });
      }
      if (outcome.result.done) break;
      await ensureFeatureEnabled(ctx, type, user.tenantId);
      assertNoSecretLeak(outcome.result.value);
      yield outcome.result.value;
    }
  } finally {
    unsubscribeAccessInvalidation?.();
    clearTimeout(expiryTimer);
    // Close the generator so cleanup runs; skip awaiting return() after
    // access-revoke abandonment — overlapping next()+return() can deadlock.
    if (iterator !== undefined && !abandonedForInvalidation) {
      await iterator.return?.(undefined);
    }
  }
}
