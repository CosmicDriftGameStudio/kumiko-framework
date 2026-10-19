/// <reference types="temporal-polyfill/global" preserve="true" />
import type { Temporal } from "./temporal.ts";

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly windowSeconds: number;
  readonly resetAt: Temporal.Instant;
};

export type RateLimitConfig = {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly cost?: number;
};

export type RateLimitBucketRequest = {
  readonly bucket: string;
  readonly config: RateLimitConfig;
};

export type RateLimitResolver = {
  // Atomic check + deduct. Returns the decision and current bucket state
  // — caller decides whether to throw RateLimitError or proceed.
  check(bucket: string, config: RateLimitConfig): Promise<RateLimitDecision>;

  // Convenience: throws RateLimitError when blocked. Useful inside the
  // dispatcher / middleware code-paths where the failure shape is fixed.
  enforce(bucket: string, config: RateLimitConfig): Promise<RateLimitDecision>;

  // Atomic all-or-nothing across buckets: tokens are deducted from every
  // bucket only when each one has enough; otherwise none is touched and
  // RateLimitError is thrown for the rejected bucket with the largest
  // retryAfter. Decisions are returned in request order.
  enforceAll(requests: readonly RateLimitBucketRequest[]): Promise<readonly RateLimitDecision[]>;

  // Read-only inspection: returns the same shape as check() but never
  // mutates the bucket — no token deduction, no refill-timestamp update.
  // Use for ops/status queries (e.g. "kumiko rl status user:42") that
  // must observe the bucket without disturbing it.
  peek(bucket: string, config: Omit<RateLimitConfig, "cost">): Promise<RateLimitDecision>;
};
