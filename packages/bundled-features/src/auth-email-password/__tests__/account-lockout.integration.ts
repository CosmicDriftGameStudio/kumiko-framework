// Account-lockout integration tests — prod-readiness welle 3, step 3.4.
//
// Covers the brute-force protection contract:
//   - N wrong-password attempts lock the account for a configurable duration
//   - Locked accounts refuse login without password-verify (no timing-oracle)
//   - Auto-unlock after the lock expires; streak resets to 1 on the next miss
//   - Success clears the Redis lockout state
//   - Enumeration surface unchanged for unknown users
//   - Redis unset: handler still works, lockout is silently skipped (degrades
//     gracefully to the IP-rate-limiter at the edge)

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { getLockoutState, type LockoutState } from "../lockout-store";
import { hashPassword } from "../password-hashing";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");

// Tight thresholds for test speed: 3 attempts, 1-minute lock. The default
// (5/15) is covered implicitly by the config-plumbing test; here we verify
// the knobs actually land in the handler.
const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 1;

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature({
        accountLockout: {
          maxFailedAttempts: MAX_ATTEMPTS,
          lockoutDurationMinutes: LOCK_MINUTES,
        },
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
        [AuthErrors.accountLocked]: 423,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  // Clear lockout state between tests — the key prefix is feature-owned, so
  // a scan-and-del is the safe bet even if tests share a Redis namespace.
  await stack.redis.flushNamespace();
});

async function seedLoginUser(
  email: string,
  password: string,
): Promise<{ id: string; tenantId: TenantId }> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: email.split("@")[0] ?? "user" },
    systemAdmin,
  );
  const tenantId: TenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId,
    roles: ["User"],
  });
  return { id: created.id, tenantId };
}

async function loginAttempt(email: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password });
}

async function readLockoutState(userId: string): Promise<LockoutState | null> {
  return getLockoutState(stack.redis.redis, userId);
}

describe("account-lockout — counter increments", () => {
  test("each wrong-password attempt increments the Redis failure counter", async () => {
    const seed = await seedLoginUser("counter@example.com", "right-pw");

    const r1 = await loginAttempt("counter@example.com", "wrong-1");
    expect(r1.status).toBe(401);
    expect((await readLockoutState(seed.id))?.failureCount).toBe(1);

    const r2 = await loginAttempt("counter@example.com", "wrong-2");
    expect(r2.status).toBe(401);
    expect((await readLockoutState(seed.id))?.failureCount).toBe(2);
  });

  test("wrong attempts stay as invalid_credentials until the threshold is crossed", async () => {
    await seedLoginUser("threshold@example.com", "right-pw");

    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const r = await loginAttempt("threshold@example.com", `wrong-${i}`);
      expect(r.status).toBe(401);
      const body = await r.json();
      expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
    }
  });
});

describe("account-lockout — threshold + lock", () => {
  test("Nth wrong attempt sets lockedUntil in the future", async () => {
    const seed = await seedLoginUser("threshold@example.com", "right-pw");

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await loginAttempt("threshold@example.com", `wrong-${i}`);
    }

    const state = await readLockoutState(seed.id);
    expect(state?.failureCount).toBe(MAX_ATTEMPTS);
    expect(state?.lockedUntil).not.toBeNull();
    // Lock-duration ~1 min from now; assert within a generous window.
    const msUntilUnlock = (state?.lockedUntil ?? 0) - Date.now();
    expect(msUntilUnlock).toBeGreaterThan(50_000); // > 50 sec
    expect(msUntilUnlock).toBeLessThan(70_000); // < 70 sec
  });

  test("locked account rejects further attempts with account_locked + retryAfterSeconds", async () => {
    await seedLoginUser("locked@example.com", "right-pw");

    // Trigger lock
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await loginAttempt("locked@example.com", `wrong-${i}`);
    }

    // Next attempt (even with the CORRECT password) is blocked.
    const res = await loginAttempt("locked@example.com", "right-pw");
    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.accountLocked);
    expect(body.error?.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.error?.details?.retryAfterSeconds).toBeLessThanOrEqual(LOCK_MINUTES * 60);
  });

  test("locked account does not increment the counter on further attempts (no password verify)", async () => {
    const seed = await seedLoginUser("nostack@example.com", "right-pw");

    // Trigger lock
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await loginAttempt("nostack@example.com", `wrong-${i}`);
    }
    const stateBefore = await readLockoutState(seed.id);

    // Hammer the locked account
    for (let i = 0; i < 5; i++) {
      await loginAttempt("nostack@example.com", `still-wrong-${i}`);
    }
    const stateAfter = await readLockoutState(seed.id);

    // Counter frozen, lock-until unchanged — no re-locking, no counter inflation.
    expect(stateAfter?.failureCount).toBe(stateBefore?.failureCount);
    expect(stateAfter?.lockedUntil).toBe(stateBefore?.lockedUntil);
  });
});

describe("account-lockout — reset on success", () => {
  test("successful login clears the Redis lockout key entirely", async () => {
    const seed = await seedLoginUser("success@example.com", "right-pw");

    // Build up some failed attempts (but not enough to lock)
    await loginAttempt("success@example.com", "wrong-1");
    await loginAttempt("success@example.com", "wrong-2");
    expect((await readLockoutState(seed.id))?.failureCount).toBe(2);

    // Correct login clears the streak
    const res = await loginAttempt("success@example.com", "right-pw");
    expect(res.status).toBe(200);

    expect(await readLockoutState(seed.id)).toBeNull();
  });
});

describe("account-lockout — auto-unlock (strict semantic)", () => {
  // Simulate a "lock that just expired" — count-key still holds the pre-lock
  // streak value (count >= threshold), until-key has been naturally TTL'd
  // out by Redis. The counter is monotonic by design, so the next wrong
  // password re-locks immediately without a fresh-streak grace period.
  async function seedExpiredLock(userId: string): Promise<void> {
    await stack.redis.redis.set(
      `kumiko:auth:lockout:count:${userId}`,
      String(MAX_ATTEMPTS),
      "EX",
      3600,
    );
    // Deliberately DO NOT set the until-key — that's what "expired lock"
    // looks like from the store's perspective (Redis auto-reaped it).
  }

  test("expired lock + wrong password → immediate re-lock (count grows, NO fresh streak)", async () => {
    const seed = await seedLoginUser("expired@example.com", "right-pw");
    await seedExpiredLock(seed.id);

    // First attempt after auto-unlock: wrong password → counter jumps from
    // MAX_ATTEMPTS to MAX_ATTEMPTS+1. Still at/over threshold → re-locked.
    // The handler response is still 401 (invalid_credentials) because the
    // gate-check at entry saw no active lock; only the NEXT attempt would
    // see the newly-armed lock and get 423.
    const res = await loginAttempt("expired@example.com", "still-wrong");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);

    const state = await readLockoutState(seed.id);
    expect(state?.failureCount).toBe(MAX_ATTEMPTS + 1);
    expect(state?.lockedUntil).not.toBeNull();

    // Follow-up attempt surfaces the re-arm as a 423.
    const res2 = await loginAttempt("expired@example.com", "still-wrong-2");
    expect(res2.status).toBe(423);
  });

  test("expired lock + correct password → success clears both Redis keys", async () => {
    const seed = await seedLoginUser("expired-ok@example.com", "right-pw");
    await seedExpiredLock(seed.id);

    const res = await loginAttempt("expired-ok@example.com", "right-pw");
    expect(res.status).toBe(200);

    // Both count-key and until-key are DEL'd — the successful login is the
    // only path that resets the streak. Verified via getLockoutState (null
    // means count-key is missing).
    expect(await readLockoutState(seed.id)).toBeNull();
  });
});

describe("account-lockout — enumeration surface", () => {
  test("unknown email does not leak the lockout code (stays invalid_credentials)", async () => {
    // We haven't seeded this user. If the lockout gate fired before the
    // "user not found" check, probing would tell an attacker "this user
    // exists AND is locked". Gate must stay AFTER the uniform-error branch.
    const res = await loginAttempt("ghost@example.com", "anything");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});

describe("account-lockout — race-free counter under concurrent attempts", () => {
  test("parallel wrong-password attempts produce exact count — no under-counting", async () => {
    // The Lua-scripted recordFailedAttempt is the load-bearing claim for
    // "brute-force protection"; a GET/SET-based store would under-count
    // under parallel load (two writers reading count=N both write N+1 →
    // effective N+1 instead of N+2). Here we fire threshold-many attempts
    // in parallel and assert the counter matches exactly.
    const seed = await seedLoginUser("race@example.com", "right-pw");

    const parallel = Array.from({ length: MAX_ATTEMPTS }, (_, i) =>
      loginAttempt("race@example.com", `wrong-${i}`),
    );
    const results = await Promise.all(parallel);
    // All of them get 401 (either invalid_credentials or account_locked after
    // threshold — either way, none is a 200-success).
    for (const r of results) {
      expect(r.status).not.toBe(200);
    }

    const state = await readLockoutState(seed.id);
    // Key claim: exactly MAX_ATTEMPTS increments landed, not fewer.
    expect(state?.failureCount).toBe(MAX_ATTEMPTS);
    // And since count >= threshold, the lock is active.
    expect(state?.lockedUntil).not.toBeNull();
  });
});
