import type { Redis } from "ioredis";
import { createFallbackLogger } from "../logging/index.ts";
import type { LoginRateLimiter } from "./auth-routes-types.ts";

let warnedInMemoryLimiterInProduction = false;

// Without Redis-backed limiters each replica counts on its own, so the effective limit scales with replica count.
export function inMemoryLoginRateLimiterFallback(): LoginRateLimiter {
  if (process.env["NODE_ENV"] === "production" && !warnedInMemoryLimiterInProduction) {
    warnedInMemoryLimiterInProduction = true;
    createFallbackLogger("auth-routes").warn(
      "login/MFA rate limiter falls back to in-memory; limits are per replica",
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

  return {
    async check(key) {
      const now = Date.now();
      if (hits.size >= sweepThreshold) sweepExpired(now);

      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        enforceCap();
        return true;
      }
      if (entry.count >= maxAttempts) return false;
      entry.count++;
      return true;
    },
    async reset(key) {
      hits.delete(key);
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

  return {
    async check(key) {
      const redisKey = `${prefix}${key}`;
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
      const count: unknown = await redis.eval(
        `local c = redis.call('INCR', KEYS[1])
         if c == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
         return c`,
        1,
        redisKey,
        windowMs,
      );
      const attempts = typeof count === "string" && /^\d+$/.test(count) ? Number(count) : count;
      if (typeof attempts !== "number" || !Number.isInteger(attempts)) {
        throw new TypeError(`redis INCR script returned ${String(count)}, expected an integer`);
      }
      return attempts <= maxAttempts;
    },
    async reset(key) {
      await redis.del(`${prefix}${key}`);
    },
  };
}
