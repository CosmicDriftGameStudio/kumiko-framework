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
//
// The counter mechanics (race-free INCR/NX, TTL rules, monotonic-counter
// semantics) live in shared/lockout-counter.ts — this file only wires the
// mfa-verify key prefixes onto it.

import { createLockoutCounter, type LockoutCounterState } from "../shared";

export type MfaVerifyLockoutState = LockoutCounterState;

const COUNT_KEY_PREFIX = "kumiko:auth:mfa-verify:count:";
const UNTIL_KEY_PREFIX = "kumiko:auth:mfa-verify:until:";

const counter = createLockoutCounter(COUNT_KEY_PREFIX, UNTIL_KEY_PREFIX);

export const getMfaVerifyLockoutState = counter.getState;
export const recordFailedMfaVerifyAttempt = counter.recordFailedAttempt;
export const clearMfaVerifyAttempts = counter.clearState;
