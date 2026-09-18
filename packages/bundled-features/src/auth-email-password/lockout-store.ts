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
//
// The counter mechanics (race-free INCR/NX, TTL rules, monotonic-counter
// semantics) live in shared/lockout-counter.ts — this file only wires the
// account-lockout key prefixes onto it. See that file for why a lock
// re-arms immediately after expiry, and why a successful login (or the
// account-unlock magic-link flow, #1266, see
// handlers/confirm-account-unlock.write.ts) is what resets the streak.

import { createLockoutCounter, type LockoutCounterState } from "../shared";

export type LockoutState = LockoutCounterState;

const COUNT_KEY_PREFIX = "kumiko:auth:lockout:count:";
const UNTIL_KEY_PREFIX = "kumiko:auth:lockout:until:";

const counter = createLockoutCounter(COUNT_KEY_PREFIX, UNTIL_KEY_PREFIX);

export const getLockoutState = counter.getState;
export const recordFailedAttempt = counter.recordFailedAttempt;
export const clearLockoutState = counter.clearState;
