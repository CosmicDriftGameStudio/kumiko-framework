import { hasAccess } from "../engine/access";
import type { SessionUser } from "../engine/types";
import { AccessDeniedError, NotFoundError, validationErrorFromZod } from "../errors";
import { assertNoSecretLeak } from "../secrets";
import {
  buildHandlerContext,
  type DispatchContext,
  enforceRateLimit,
  ensureFeatureEnabled,
  runStreamInstrumented,
} from "./dispatch-shared";

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
): AsyncGenerator<unknown> {
  yield* runStreamInstrumented(ctx, type, user, () => executeStreamInner(ctx, type, payload, user));
}

async function* executeStreamInner(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
): AsyncGenerator<unknown> {
  const { registry } = ctx;
  const handler = registry.getStreamHandler(type);
  if (!handler) throw new NotFoundError("handler", type);

  await ensureFeatureEnabled(ctx, type, user.tenantId);

  if (handler.rateLimit !== undefined) {
    await enforceRateLimit(ctx, handler.rateLimit, type, user);
  }

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

  // Idle (heartbeat-only) streams must also cut on access revoke — race each
  // pull against an invalidated Deferred instead of a post-chunk boolean.
  let resolveInvalidated: (() => void) | undefined;
  const invalidated = new Promise<void>((resolve) => {
    resolveInvalidated = resolve;
  });
  const unsubscribeAccessInvalidation = ctx.sseBroker?.subscribeAccessInvalidation(user.id, () => {
    resolveInvalidated?.();
  });

  let iterator: AsyncIterator<unknown> | undefined;
  // When access is revoked mid-pull, `iterator.next()` is still in flight.
  // Awaiting `iterator.return()` in that state deadlocks async generators in
  // Bun (overlapping next+return). Track abandonment so finally skips the
  // await; close is fire-and-forget instead (#1563).
  let abandonedForInvalidation = false;
  try {
    const handlerContext = await buildHandlerContext(ctx, type, user);
    const chunks = handler.handler({ type, payload: parsed.data, user }, handlerContext);
    iterator = chunks[Symbol.asyncIterator]();

    while (true) {
      const nextPull = iterator.next();
      const outcome = await Promise.race([
        nextPull.then((result) => ({ kind: "chunk" as const, result })),
        invalidated.then(() => ({ kind: "invalidated" as const })),
      ]);
      if (outcome.kind === "invalidated") {
        abandonedForInvalidation = true;
        void nextPull.catch(() => {});
        void iterator.return?.(undefined)?.then(undefined, () => {});
        throw new AccessDeniedError({
          message: `access revoked mid-stream for ${type}`,
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
    // Consumer break / throw — always close the handler generator so its
    // finally (cleanup) runs (for-await would do this). Do NOT swallow
    // return() errors — close-time cleanup failures must surface to
    // runStreamInstrumented (#1543). Skip the await after access-revoke
    // abandonment (overlapping next+return deadlocks — see above).
    if (iterator !== undefined && !abandonedForInvalidation) {
      await iterator.return?.(undefined);
    }
  }
}
