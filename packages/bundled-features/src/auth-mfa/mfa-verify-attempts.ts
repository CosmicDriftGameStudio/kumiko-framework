// Redis-backed brute-force cap for `/auth/mfa/verify`, keyed by userId (NOT
// by challenge token). Modeled on auth-email-password/lockout-store.ts.
//
// Why keyed by userId, not challengeToken: a challenge token is reissued on
// every successful password login (see mfa-challenge-token.ts) — a fresh
// token would reset a token-keyed counter to zero, letting an attacker who
// already has the password just re-login repeatedly to get unlimited TOTP
// guesses. A 6-digit code with a ±1-step window has 3 valid values out of
// 10^6; without a cap that survives across challenge reissuance, online
// brute-force is practical. The counter's lifetime crosses token
// boundaries on purpose.
//
// This is INDEPENDENT of the AuthRoutesConfig.mfaVerifyRateLimit on the
// framework route (IP-scoped abuse protection for the endpoint itself) —
// both are needed, neither substitutes for the other.

import type Redis from "ioredis";

export type MfaVerifyLockoutState = {
  readonly failureCount: number;
  readonly lockedUntil: number | null;
};

const COUNT_KEY_PREFIX = "kumiko:auth:mfa-verify:count:";
const UNTIL_KEY_PREFIX = "kumiko:auth:mfa-verify:until:";

function countKey(userId: string): string {
  return `${COUNT_KEY_PREFIX}${userId}`;
}
function untilKey(userId: string): string {
  return `${UNTIL_KEY_PREFIX}${userId}`;
}

export async function getMfaVerifyLockoutState(
  redis: Redis,
  userId: string,
): Promise<MfaVerifyLockoutState | null> {
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

// Race-free: INCR is atomic, NX on the until-key means only the attempt
// that first crosses the threshold anchors the lock window — see
// lockout-store.ts's recordFailedAttempt for the identical reasoning.
export async function recordFailedMfaVerifyAttempt(
  redis: Redis,
  userId: string,
  maxAttempts: number,
  lockoutMinutes: number,
): Promise<MfaVerifyLockoutState> {
  const lockDurationMs = lockoutMinutes * 60 * 1000;
  const ttlSec = Math.max(lockoutMinutes * 60, 24 * 3600);

  const count = await redis.incr(countKey(userId));
  if (count === 1) {
    await redis.expire(countKey(userId), ttlSec);
  }

  let lockedUntil: number | null = null;
  if (count >= maxAttempts) {
    const computedUntil = Date.now() + lockDurationMs;
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
      const existing = await redis.get(untilKey(userId));
      lockedUntil = existing !== null ? Number(existing) : null;
    }
  }

  return { failureCount: count, lockedUntil };
}

// Called on a successful verify. The only path that resets the streak.
export async function clearMfaVerifyAttempts(redis: Redis, userId: string): Promise<void> {
  await redis.del(countKey(userId), untilKey(userId));
}
