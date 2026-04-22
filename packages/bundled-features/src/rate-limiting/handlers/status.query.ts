import { defineQueryHandler } from "@kumiko/framework/engine";
import { UnprocessableError } from "@kumiko/framework/errors";
import { z } from "zod";
import { RateLimitErrors } from "../constants";

// Ops-side bucket inspection. Pass the bucket key (e.g. "user:42",
// "user+handler:42:orders:write:order:create") plus the limit/window the bucket
// was configured with, and get back the current state. Backed by
// resolver.peek() — purely read-only, no token deduction and no
// refill-timestamp update, so dashboards can poll without nudging the
// bucket state ahead of the next real request.
//
// Use cases: ops-CLI ("kumiko rl status user:42"), support agent debugging
// "why is this user blocked", dashboard tile.
//
// Bucket key format is owned by the framework (see rate-limit/bucket.ts);
// callers pass the constructed key directly. We don't synthesize from
// (per, user, handler) here — peeking is a low-level op, the lookup
// surface stays small.
export const rateLimitStatus = defineQueryHandler({
  // Short name — the registry qualifies this to `rate-limiting:query:status`
  // when the feature is registered. Passing the qualified form here would
  // double-prefix it and the handler wouldn't be reachable.
  name: "status",
  schema: z.object({
    bucket: z.string().min(1),
    limit: z.number().int().positive(),
    windowSeconds: z.number().int().positive(),
  }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.rateLimit) {
      throw new UnprocessableError(RateLimitErrors.resolverUnavailable, {
        i18nKey: "rateLimiting.errors.resolverUnavailable",
      });
    }
    const decision = await ctx.rateLimit.peek(query.payload.bucket, {
      limit: query.payload.limit,
      windowSeconds: query.payload.windowSeconds,
    });
    return {
      bucket: query.payload.bucket,
      limit: decision.limit,
      remaining: decision.remaining,
      windowSeconds: decision.windowSeconds,
      // resetAt is meaningful only if the bucket is currently exhausted;
      // we still return it so dashboards can show "next refill" uniformly.
      resetAt: decision.resetAt.toString(),
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  },
});
