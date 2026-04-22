export const RATE_LIMITING_FEATURE = "rateLimiting" as const;

export const RateLimitQueries = {
  status: "rate-limiting:query:status",
} as const;

export const RateLimitErrors = {
  resolverUnavailable: "rate_limit_resolver_unavailable",
} as const;
