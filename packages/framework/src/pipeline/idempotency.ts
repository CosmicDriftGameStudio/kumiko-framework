import type Redis from "ioredis";
import { InternalError } from "../errors";
import { generateId } from "../utils";
import { RedisKeys } from "./redis-keys";

// Discriminated so a truthy "acquired" object can never be misread as a
// cache hit by a callsite doing `if (result)` — the caller must switch on
// `status`.
export type IdempotencyCheckResult =
  | { readonly status: "cached"; readonly result: string }
  | { readonly status: "acquired"; readonly token: string };

export type IdempotencyGuard = {
  check(tenantId: string, userId: string, requestId: string): Promise<IdempotencyCheckResult>;
  store(
    tenantId: string,
    userId: string,
    requestId: string,
    token: string,
    result: unknown,
  ): Promise<void>;
};

// Sentinel prefix stored under the key while the handler is running. Each
// acquisition appends a unique token so store() can later prove it still
// owns the lock it started with (see storeScript below) instead of blindly
// overwriting whatever is currently there.
const PENDING_PREFIX = "__pending__:";

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
  // Must stay comfortably above pendingTtl: a wait shorter than the lock's
  // own TTL makes a retry give up and re-run the handler while the original
  // call is still legitimately in flight — the exact case this lock exists
  // to prevent. Clamped rather than trusted so a misconfigured explicit
  // option can't reintroduce that inversion.
  const waitTimeoutMs = Math.max(options.waitTimeoutMs ?? 35_000, pendingTtl * 1000 + 5_000);
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const prefix = RedisKeys.idempotency;

  // Atomic compare-and-swap: only persist the result if the key still holds
  // the exact pending token this run acquired. If a parallel retry reclaimed
  // an expired lock in the meantime, this is a no-op — the reclaiming run
  // owns the key now and will persist the authoritative result itself.
  const storeScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      redis.call("set", KEYS[1], ARGV[2], "EX", ARGV[3])
      return 1
    else
      return 0
    end
  `;

  async function tryAcquire(key: string): Promise<string | null> {
    const token = `${PENDING_PREFIX}${generateId()}`;
    const acquired = await redis.set(key, token, "EX", pendingTtl, "NX");
    return acquired === "OK" ? token : null;
  }

  return {
    // Returns:
    //   { status: "acquired", token } — caller owns the in-progress lock,
    //     proceed to run the handler and then call store() with this token.
    //   { status: "cached", result }  — serialized result from a concurrent
    //     or prior request; do not run the handler.
    //
    // The old behaviour (pure GET + SET-NX-store) let two parallel requests
    // both see a cache miss, both execute side-effects, and only one persist
    // the result. This version uses a pending-marker lock so the second caller
    // waits for the first to finish and reuses its result.
    async check(tenantId, userId, requestId) {
      const key = `${prefix}${tenantId}:${userId}:${requestId}`;

      const token = await tryAcquire(key);
      if (token) return { status: "acquired", token };

      // Lost the race. Poll until the lock holder stores a result, or the
      // lock expires (handler crashed) and we can try again.
      const deadline = Date.now() + waitTimeoutMs;
      while (Date.now() < deadline) {
        const value = await redis.get(key);
        if (value === null || value.startsWith(PENDING_PREFIX)) {
          if (value === null) {
            // Lock expired before a result was stored — try to claim it
            // ourselves and proceed as the new owner.
            const reclaimed = await tryAcquire(key);
            if (reclaimed) return { status: "acquired", token: reclaimed };
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          continue;
        }
        return { status: "cached", result: value };
      }

      // Gave up waiting. By construction waitTimeoutMs > pendingTtl, so the
      // lock must have expired already — make one last claim attempt rather
      // than silently reporting ownership we never acquired (that would
      // reintroduce the double-execute bug). If even that loses the race,
      // fail loudly instead of running the handler a second time.
      const finalValue = await redis.get(key);
      if (finalValue !== null && !finalValue.startsWith(PENDING_PREFIX)) {
        return { status: "cached", result: finalValue };
      }
      const lastResort = await tryAcquire(key);
      if (lastResort) return { status: "acquired", token: lastResort };
      throw new InternalError({
        message: `idempotency lock contention: gave up waiting for requestId ${requestId}`,
      });
    },

    async store(tenantId, userId, requestId, token, result) {
      const key = `${prefix}${tenantId}:${userId}:${requestId}`;
      // @cast-boundary db-operator — Lua EVAL return type is untyped in ioredis
      const written = (await redis.eval(
        storeScript,
        1,
        key,
        token,
        JSON.stringify(result),
        String(ttl),
      )) as number;
      // written === 0 means another process reclaimed this key after our
      // lock expired and is (or already did) persist its own result —
      // silently skipping here is the fix: the old code did an unconditional
      // SET and could stomp that fresher result with our stale one.
      void written;
    },
  };
}
