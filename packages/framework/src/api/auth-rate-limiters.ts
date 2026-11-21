import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { LoginRateLimiter, RateLimitReservation } from "./auth-routes-types.ts";

// Production fails closed: per-replica counts plus FIFO eviction of the bounded
// map let an attacker reset a target's bucket. runProdApp wires Redis limiters.
export function inMemoryLoginRateLimiterFallback(): LoginRateLimiter {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[kumiko:boot] login/MFA rate limiter would fall back to in-memory in production: limits would be per replica and the bounded map evicts the oldest buckets, so an attacker can reset a target's bucket. Pass a Redis-backed limiter (createRedisLoginRateLimiter) for loginRateLimit and the MFA rate limits, or null to disable one explicitly.",
    );
  }
  return createInMemoryLoginRateLimiter();
}

// Default: in-memory fixed window. Fine for a single Node process; for
// multi-process deployments, inject a Redis-backed LoginRateLimiter instead
// so attempts can't be spread across replicas.
//
// Memory management: entries expire after `windowMs` but the map entries
// themselves linger until something touches them. To stop the map from
// growing unbounded (a single attacker can create entries with different
// `ip|email` buckets at ~req rate), we opportunistically sweep expired
// entries when the map crosses `sweepThreshold` keys and hard-cap total
// entries at `maxEntries` — oldest ones get dropped first.
export function createInMemoryLoginRateLimiter(
  maxAttempts = 10,
  windowMs = 5 * 60_000,
  {
    maxEntries = 10_000,
    sweepThreshold = 1_000,
  }: { maxEntries?: number; sweepThreshold?: number } = {},
): LoginRateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();

  function sweepExpired(now: number): void {
    for (const [k, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(k);
    }
  }

  function enforceCap(): void {
    // Map iteration is insertion-order, so the oldest entries are first.
    // Drop from the front until we're back under the cap.
    // skip: under the cap, nothing to do
    if (hits.size <= maxEntries) return;
    const toDrop = hits.size - maxEntries;
    let dropped = 0;
    for (const k of hits.keys()) {
      if (dropped >= toDrop) break;
      hits.delete(k);
      dropped++;
    }
  }

  function reserve(key: string): RateLimitReservation {
    const now = Date.now();
    if (hits.size >= sweepThreshold) sweepExpired(now);

    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      hits.set(key, { count: 1, resetAt });
      enforceCap();
      return { allowed: true, window: String(resetAt) };
    }
    const window = String(entry.resetAt);
    if (entry.count >= maxAttempts) return { allowed: false, window };
    entry.count++;
    return { allowed: true, window };
  }

  return {
    async check(key) {
      return reserve(key).allowed;
    },
    async reserve(key) {
      return reserve(key);
    },
    async reset(key) {
      hits.delete(key);
    },
    async refund(key, window) {
      const entry = hits.get(key);
      if (
        entry &&
        String(entry.resetAt) === window &&
        entry.resetAt > Date.now() &&
        entry.count > 0
      ) {
        entry.count--;
      }
    },
  };
}

// Redis-backed sibling of createInMemoryLoginRateLimiter — same fixed-window
// semantics (count <= maxAttempts allows, window anchored on first hit), but
// shared across replicas via INCR/PEXPIRE instead of an in-process Map.
// runProdApp defaults to this: an in-memory limiter only rate-limits within
// a single instance, so a multi-replica prod deployment would silently give
// each replica its own bucket. namespace separates the login-key keyspace
// from the mfa-verify one (they share the same LoginRateLimiter shape but
// key on different values).
// Fail-closed on Redis outage, unlike the in-memory limiter (which never
// throws): `check`/`reset` propagate any Redis error, so callers 500
// instead of falling back to unlimited attempts. Deliberate — Redis is
// already required infra for a multi-replica deployment, and for a
// security-relevant limiter "briefly unavailable" should read as "briefly
// down", not "briefly unlimited".
export function createRedisLoginRateLimiter(
  redis: Redis,
  maxAttempts = 10,
  windowMs = 5 * 60_000,
  namespace = "login",
): LoginRateLimiter {
  const prefix = `kumiko:auth:ratelimit:${namespace}:`;
  const windowKeyOf = (redisKey: string): string => `${redisKey}:w`;

  // INCR then PEXPIRE was two round-trips: a crash/network blip between
  // them (only possible right after count===1, when the key is fresh)
  // left the key permanently without a TTL — the window never resets,
  // the counter only grows, and the bucket is locked out until an
  // operator manually resets/deletes the key. One atomic eval closes
  // the gap: the TTL is set in the same script invocation that creates
  // the key, so no observer (including a crash) can see count===1
  // without the expiry already applied. The `PTTL < 0` branch also
  // heals keys that already exist without a TTL from before this fix
  // shipped (PTTL returns -1 for "no expiry set, key exists") — without
  // it, those pre-existing keys would grow forever with no way back to
  // a normal window.
  // The companion `:w` key holds an id of the current window with the same expiry, so a
  // refund can tell whether its slot still belongs to the live window.
  const RESERVE_SCRIPT = `local c = redis.call('INCR', KEYS[1])
    if c == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    local w = redis.call('GET', KEYS[2])
    if c == 1 or not w then
      redis.call('SET', KEYS[2], ARGV[2], 'PX', math.max(1, redis.call('PTTL', KEYS[1])))
      w = ARGV[2]
    end
    return {c, w}`;
  // Guarded so DECR never creates a TTL-less negative counter on a missing key.
  const REFUND_SCRIPT = `if redis.call('GET', KEYS[2]) == ARGV[1] then
      local c = tonumber(redis.call('GET', KEYS[1]))
      if c and c > 0 then redis.call('DECR', KEYS[1]) end
    end
    return 0`;

  async function reserve(key: string): Promise<RateLimitReservation> {
    const redisKey = `${prefix}${key}`;
    const reply: unknown = await redis.eval(
      RESERVE_SCRIPT,
      2,
      redisKey,
      windowKeyOf(redisKey),
      windowMs,
      randomUUID(),
    );
    const [count, window] = Array.isArray(reply) ? reply : [];
    const attempts = typeof count === "string" && /^\d+$/.test(count) ? Number(count) : count;
    if (typeof attempts !== "number" || !Number.isInteger(attempts) || typeof window !== "string") {
      throw new TypeError(
        `redis reserve script returned ${JSON.stringify(reply)}, expected [integer, window id]`,
      );
    }
    return { allowed: attempts <= maxAttempts, window };
  }

  return {
    async check(key) {
      return (await reserve(key)).allowed;
    },
    reserve,
    async reset(key) {
      const redisKey = `${prefix}${key}`;
      await redis.del(redisKey, windowKeyOf(redisKey));
    },
    async refund(key, window) {
      const redisKey = `${prefix}${key}`;
      await redis.eval(REFUND_SCRIPT, 2, redisKey, windowKeyOf(redisKey), window);
    },
  };
}
