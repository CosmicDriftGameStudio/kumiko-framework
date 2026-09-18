// Generic Redis-backed failed-attempt counter with auto-expiring lockout.
// Extracted from auth-email-password/lockout-store.ts and
// auth-mfa/mfa-verify-attempts.ts (infra#446) — both were byte-identical
// INCR/NX logic, differing only in their Redis key prefixes.

import type Redis from "ioredis";

export type LockoutCounterState = {
  readonly failureCount: number;
  // Epoch milliseconds when the account/attempt auto-unlocks. null while the
  // counter is still below threshold.
  readonly lockedUntil: number | null;
};

// Two keys per subject so each can carry its own TTL:
//   - count-key: 24h, carries the streak. Monotonic — once threshold is
//     crossed it STAYS crossed until the caller explicitly clears it.
//   - until-key: exactly the lockout duration, auto-expires when the lock
//     ends (Redis TTL replaces a "timer" that would otherwise need a job).
//
// Consequence of the monotonic counter: once a subject has been locked, the
// NEXT failure after the lock expires re-locks immediately — the INCR still
// returns a value ≥ threshold, so the SET NX re-arms the lock. Clearing the
// streak is the caller's responsibility (e.g. a successful login, or a
// dedicated unlock flow) — intentional: brute-force resistance favours
// strictness over UX for anonymous attempts.
export function createLockoutCounter(countKeyPrefix: string, untilKeyPrefix: string) {
  function countKey(subjectId: string): string {
    return `${countKeyPrefix}${subjectId}`;
  }
  function untilKey(subjectId: string): string {
    return `${untilKeyPrefix}${subjectId}`;
  }

  async function getState(redis: Redis, subjectId: string): Promise<LockoutCounterState | null> {
    const [countRaw, untilRaw] = await redis.mget(countKey(subjectId), untilKey(subjectId));
    if (countRaw === null) return null;
    const failureCount = Number(countRaw);
    if (!Number.isFinite(failureCount)) return null;
    const lockedUntil = untilRaw !== null ? Number(untilRaw) : null;
    return {
      failureCount,
      lockedUntil: lockedUntil !== null && Number.isFinite(lockedUntil) ? lockedUntil : null,
    };
  }

  // Race-free: INCR is atomic at the Redis level, so N concurrent failed
  // attempts produce exactly N increments — no GET-SET window to lose an
  // increment through. The NX on the until-key likewise guarantees only one
  // attempt out of a concurrent batch sets the lock timestamp; subsequent
  // concurrent attempts find the key already set and leave it alone, so the
  // lock window stays anchored to the first-to-cross, not the last.
  async function recordFailedAttempt(
    redis: Redis,
    subjectId: string,
    maxFailedAttempts: number,
    lockoutDurationMinutes: number,
  ): Promise<LockoutCounterState> {
    const lockDurationMs = lockoutDurationMinutes * 60 * 1000;
    // TTL on the count-key: 24h covers "I fat-fingered yesterday". The
    // lockout duration is on the until-key; the count-key outlives it so an
    // expired lock leaves a counter ≥ threshold — that's what makes the next
    // miss immediately re-lock (strict-semantic; see the type-comment above).
    const ttlSec = Math.max(lockoutDurationMinutes * 60, 24 * 3600);

    const count = await redis.incr(countKey(subjectId));
    if (count === 1) {
      // First failure → set the TTL. INCR doesn't set one; a counter without
      // TTL would leak forever for subjects that never return.
      await redis.expire(countKey(subjectId), ttlSec);
    }

    let lockedUntil: number | null = null;
    if (count >= maxFailedAttempts) {
      const computedUntil = Date.now() + lockDurationMs;
      // NX: only set if no lock is currently armed. A second concurrent attempt
      // arriving after the first crossed the threshold must NOT reset the
      // timer — the lock window should align with the attempt that crossed,
      // not the one that happened a millisecond later.
      const setOk = await redis.set(
        untilKey(subjectId),
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
        // getState would see.
        const existing = await redis.get(untilKey(subjectId));
        lockedUntil = existing !== null ? Number(existing) : null;
      }
    }

    return { failureCount: count, lockedUntil };
  }

  // Idempotent — deleting missing keys is a no-op, so a replayed clear just
  // re-clears harmlessly.
  async function clearState(redis: Redis, subjectId: string): Promise<void> {
    await redis.del(countKey(subjectId), untilKey(subjectId));
  }

  return { getState, recordFailedAttempt, clearState };
}
