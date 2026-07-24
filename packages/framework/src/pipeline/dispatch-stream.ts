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

  const handlerContext = buildHandlerContext(ctx, type, user);
  const chunks = handler.handler({ type, payload: parsed.data, user }, handlerContext);

  // Consumer-driven pull (for await) is the backpressure mechanism — the
  // handler generator only advances once the caller reads the previous
  // chunk, no explicit buffering/throttling needed on either side.
  for await (const chunk of chunks) {
    // Re-checked per chunk, not just at stream-start: a feature disabled
    // mid-stream must cut an already-open stream, not just block new ones.
    await ensureFeatureEnabled(ctx, type, user.tenantId);
    assertNoSecretLeak(chunk);
    yield chunk;
  }
}
