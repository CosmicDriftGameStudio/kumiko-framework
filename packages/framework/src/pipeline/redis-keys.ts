// Central registry of all Redis key prefixes used by the framework.
// Prevents prefix collisions and makes key usage discoverable.

export const RedisKeys = {
  idempotency: "kumiko:idempotency:",
  lock: "kumiko:lock:",
  events: "kumiko:events",
  eventLog: "kumiko:events:log",
} as const;
