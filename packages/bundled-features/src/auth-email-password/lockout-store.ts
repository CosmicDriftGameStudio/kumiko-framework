// Redis-backed account-lockout state for the login handler.
//
// Why Redis, not DB? The login handler returns WriteFailure on bad
// credentials — the dispatcher rolls back the whole transaction, which
// would wipe a DB-based counter-update alongside the "invalid credentials"
// response. Redis operations run outside the DB tx and survive the rollback.
// Consistent with token-burn-store.ts, which uses Redis for the same reason
// (state that must persist regardless of the handler's WriteResult).
//
// Persistence note: in prod, configure Redis with AOF or RDB so lockout
// state survives Redis restart. Without persistence, a restart resets every
// active counter — an attacker could exploit the gap, though the IP-level
// rate-limiter (framework rate-limit) is the parallel defense for that
// case anyway.

import type Redis from "ioredis";

export type LockoutState = {
  readonly failureCount: number;
  // Epoch milliseconds when the account auto-unlocks. null while the
  // counter is still below threshold.
  readonly lockedUntil: number | null;
};

// Two keys per user so each can carry its own TTL:
//   - count-key: 24h, carries the streak. Monotonic — once threshold is
//     crossed it STAYS crossed until a successful login clears it.
//   - until-key: exactly the lockout duration, auto-expires when the lock
//     ends (Redis TTL replaces a "timer" that would otherwise need a job).
//
// Consequence of the monotonic counter: once a user has been locked, the
// NEXT wrong password after the lock expires re-locks immediately — the
// INCR still returns a value ≥ threshold, so the SET NX re-arms the lock.
// A successful login is one way to reset the streak; the other is the
// account-unlock magic-link flow (#1266, see
// handlers/confirm-account-unlock.write.ts), a deliberate escape hatch for
// a legitimate user who can't currently produce the right password (e.g.
// they forgot it too) but can prove mailbox ownership. Intentional:
// brute-force resistance favours strictness over UX for anonymous login
// attempts, while the unlock flow keeps the DoS from being permanent.
const COUNT_KEY_PREFIX = "kumiko:auth:lockout:count:";
const UNTIL_KEY_PREFIX = "kumiko:auth:lockout:until:";

function countKey(userId: string): string {
  return `${COUNT_KEY_PREFIX}${userId}`;
}
function untilKey(userId: string): string {
  return `${UNTIL_KEY_PREFIX}${userId}`;
}

export async function getLockoutState(redis: Redis, userId: string): Promise<LockoutState | null> {
  const [countRaw, untilRaw] = await redis.mget(countKey(userId), untilKey(userId));
  if (countRaw === null) return null;
  const failureCount = Number(countRaw);
  if (!Number.isFinite(failureCount)) return null;
  const lockedUntil = untilRaw !== null ? Number(untilRaw) : null;
  return {
    failureCount,
    lockedUntil: lockedUntil !== null && Number.isFinite(lockedUntil) ? lockedUntil : null,
  };
}

// Race-free: INCR is atomic at the Redis level, so N concurrent wrong-
// password attempts produce exactly N increments — no GET-SET window to
// lose an increment through. The NX on the until-key likewise guarantees
// only one attempt out of a concurrent batch sets the lock timestamp;
// subsequent concurrent attempts find the key already set and leave it
// alone, so the lock window stays anchored to the first-to-cross, not
// the last.
export async function recordFailedAttempt(
  redis: Redis,
  userId: string,
  maxFailedAttempts: number,
  lockoutDurationMinutes: number,
): Promise<LockoutState> {
  const lockDurationMs = lockoutDurationMinutes * 60 * 1000;
  // TTL on the count-key: 24h covers "I fat-fingered yesterday". The
  // lockout duration is on the until-key; the count-key outlives it so an
  // expired lock leaves a counter ≥ threshold — that's what makes the next
  // miss immediately re-lock (strict-semantic; see the type-comment above).
  const ttlSec = Math.max(lockoutDurationMinutes * 60, 24 * 3600);

  const count = await redis.incr(countKey(userId));
  if (count === 1) {
    // First failure → set the TTL. INCR doesn't set one; a counter without
    // TTL would leak forever for users that never return.
    await redis.expire(countKey(userId), ttlSec);
  }

  let lockedUntil: number | null = null;
  if (count >= maxFailedAttempts) {
    const computedUntil = Date.now() + lockDurationMs;
    // NX: only set if no lock is currently armed. A second concurrent attempt
    // arriving after the first crossed the threshold must NOT reset the
    // timer — the lock window should align with the attempt that crossed,
    // not the one that happened a millisecond later.
    const setOk = await redis.set(
      untilKey(userId),
      String(computedUntil),
      "PX",
      lockDurationMs,
      "NX",
    );
    if (setOk === "OK") {
      lockedUntil = computedUntil;
    } else {
      // Another concurrent attempt already locked — read the authoritative
      // timestamp so the returned state matches what a follow-up
      // getLockoutState would see.
      const existing = await redis.get(untilKey(userId));
      lockedUntil = existing !== null ? Number(existing) : null;
    }
  }

  return { failureCount: count, lockedUntil };
}

// Called on successful login, and on a confirmed account-unlock token
// (#1266). Idempotent — deleting missing keys is a no-op, so a replayed
// unlock link just re-clears harmlessly.
export async function clearLockoutState(redis: Redis, userId: string): Promise<void> {
  await redis.del(countKey(userId), untilKey(userId));
}
