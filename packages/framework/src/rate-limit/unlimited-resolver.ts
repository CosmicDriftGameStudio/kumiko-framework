import type {
  RateLimitConfig,
  RateLimitDecision,
  RateLimitResolver,
} from "@cosmicdrift/kumiko-types/rate-limit-types";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

// Resolver for callers that are bootstrap work rather than tenant traffic (boot seeds,
// seed migrations): a handler's `rateLimit` declaration must not fail them, and they must not
// drain the buckets real requests share. Nothing is stored, so the decision is always "full bucket".
export function createUnlimitedRateLimitResolver(): RateLimitResolver {
  function fullBucket(config: Omit<RateLimitConfig, "cost">): RateLimitDecision {
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit,
      retryAfterSeconds: 0,
      windowSeconds: config.windowSeconds,
      resetAt: Temporal.Instant.fromEpochMilliseconds(Date.now()),
    };
  }

  return {
    check: async (_bucket, config) => fullBucket(config),
    enforce: async (_bucket, config) => fullBucket(config),
    peek: async (_bucket, config) => fullBucket(config),
  };
}
