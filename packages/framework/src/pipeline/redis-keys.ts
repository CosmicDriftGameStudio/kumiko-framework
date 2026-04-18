// Central registry of all Redis key prefixes used by the framework.
// Prevents prefix collisions and makes key usage discoverable.

export const RedisKeys = {
  idempotency: "kumiko:idempotency:",
  eventDedup: "kumiko:event-dedup:",
  entityCache: "kumiko:cache:",
  lock: "kumiko:lock:",
  events: "kumiko:events",
  eventLog: "kumiko:events:log",
  rateLimit: "kumiko:rl:",
} as const;
