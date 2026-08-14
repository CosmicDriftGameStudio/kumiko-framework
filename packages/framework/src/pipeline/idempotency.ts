import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

export type IdempotencyGuard = {
  check(tenantId: string, userId: string, requestId: string): Promise<string | null>;
  store(tenantId: string, userId: string, requestId: string, result: unknown): Promise<void>;
};

// Sentinel stored under the key while the handler is running. A second
// request that sees this waits for the real result instead of racing.
const PENDING_MARKER = "__pending__";

export function createIdempotencyGuard(
  redis: Redis,
  options: {
    ttlSeconds?: number;
    pendingTtlSeconds?: number;
    waitTimeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): IdempotencyGuard {
  const ttl = options.ttlSeconds ?? 300;
  // Max time a single handler is allowed to hold the in-progress lock before
  // a parallel retry is allowed to try again. Short enough that a crashed
  // handler doesn't permanently block retries, long enough to cover normal
  // batch durations.
  const pendingTtl = options.pendingTtlSeconds ?? 30;
  // Wait must OUTLAST the lock (waitTimeoutMs > pendingTtl), otherwise the
  // wait is useless: a retry gives up at 25s and re-executes while the first
  // handler is still running for up to 30s — the exact double-execute this
  // guard exists to prevent. 5s buffer covers poll drift.
  const waitTimeoutMs = options.waitTimeoutMs ?? pendingTtl * 1000 + 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const prefix = RedisKeys.idempotency;

  return {
    // Returns:
    //   null   — caller owns the in-progress lock, proceed to run the handler
    //            and then call store() with the real result.
    //   string — serialized cached result from a concurrent or prior request.
    //
    // The old behaviour (pure GET + SET-NX-store) let two parallel requests
    // both see a cache miss, both execute side-effects, and only one persist
    // the result. This version uses a pending-marker lock so the second caller
    // waits for the first to finish and reuses its result.
    async check(tenantId, userId, requestId) {
      const key = `${prefix}${tenantId}:${userId}:${requestId}`;

      // Try to acquire the in-progress lock.
      const acquired = await redis.set(key, PENDING_MARKER, "EX", pendingTtl, "NX");
      if (acquired === "OK") return null;

      // Lost the race. Poll until the lock holder stores a result, or the
      // lock expires (handler crashed) and we can try again.
      const deadline = Date.now() + waitTimeoutMs;
      while (Date.now() < deadline) {
        const value = await redis.get(key);
        if (value === null) {
          // Lock expired before a result was stored — try to claim it
          // ourselves and proceed as the new owner.
          const reclaimed = await redis.set(key, PENDING_MARKER, "EX", pendingTtl, "NX");
          if (reclaimed === "OK") return null;
          continue;
        }
        if (value !== PENDING_MARKER) return value;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      // Gave up waiting. Treat as a fresh request — forces the caller to
      // re-run the handler rather than hang indefinitely.
      return null;
    },

    async store(tenantId, userId, requestId, result) {
      // Overwrite the pending marker with the real result. Plain SET (no NX)
      // on purpose: we own the lock; writing the result is the final step.
      await redis.set(
        `${prefix}${tenantId}:${userId}:${requestId}`,
        JSON.stringify(result),
        "EX",
        ttl,
      );
    },
  };
}
