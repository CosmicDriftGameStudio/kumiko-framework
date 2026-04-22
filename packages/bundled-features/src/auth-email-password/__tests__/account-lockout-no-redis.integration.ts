// Degradation test: when ctx.redis is unavailable the login handler must
// still work — every lockout check/record becomes a no-op. The feature's
// contract explicitly allows this: lockout is brute-force hardening, not a
// login prerequisite. A setup without Redis (dev, minimal deployment, or
// operator-chosen opt-out) should have working auth at the cost of losing
// this single defense layer; the IP-level rate-limiter is the parallel
// protection that stays in place regardless.
//
// Separate file rather than a case in account-lockout.integration.ts because
// the stack must be built without `context.redis` — shared `beforeAll`
// can't mix the two.

import { randomBytes } from "node:crypto";
import { createEncryptionProvider } from "@kumiko/framework/db";
import type { TenantId } from "@kumiko/framework/engine";
import {
  createEntityTable,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/tenant-entity";
import { UserHandlers } from "../../user";
import { userEntity, userTable } from "../../user/user-entity";
import { createUserFeature } from "../../user/user-feature";
import { createAuthEmailPasswordFeature } from "../auth-email-password-feature";
import { AuthErrors, AuthHandlers } from "../constants";
import { hashPassword } from "../password-hashing";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature({
        accountLockout: { maxFailedAttempts: 2, lockoutDurationMinutes: 1 },
      }),
    ],
    // extraContext runs AFTER the default `redis: testRedis.redis` spread,
    // so setting redis:undefined here overrides it on the handler-facing
    // AppContext. Framework internals (rate-limit, idempotency, eventDedup,
    // entityCache) receive the real redis via separate buildServer wiring
    // and stay operational — only the handler's ctx.redis is gone.
    extraContext: () => ({ configResolver: resolver, redis: undefined }),
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

  await createEntityTable(stack.db.db, userEntity);
  await createEntityTable(stack.db.db, tenantEntity);
  await pushTables(stack.db.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.db.db.delete(userTable);
  await stack.db.db.delete(tenantMembershipsTable);
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
  await stack.db.db.insert(tenantMembershipsTable).values({
    userId: created.id,
    tenantId,
    roles: JSON.stringify(["User"]),
  });
  return { id: created.id, tenantId };
}

async function loginAttempt(email: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password });
}

describe("account-lockout — ctx.redis unset", () => {
  test("correct password → 200 login success (handler doesn't touch redis)", async () => {
    await seedLoginUser("ok@example.com", "right-pw");

    const res = await loginAttempt("ok@example.com", "right-pw");
    expect(res.status).toBe(200);
  });

  test("wrong password → 401 invalid_credentials (no crash trying to read lockout state)", async () => {
    await seedLoginUser("wrong@example.com", "right-pw");

    const res = await loginAttempt("wrong@example.com", "nope");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });

  test("NO lockout applied even after many attempts beyond threshold", async () => {
    // Threshold is 2 in this setup. Without redis, the counter isn't tracked,
    // so repeated misses all return 401 (invalid_credentials) — never 423
    // (account_locked). The IP-rate-limiter would be the catch in prod; we
    // don't exercise it here (authConfig leaves loginRateLimit at default).
    await seedLoginUser("many@example.com", "right-pw");

    for (let i = 0; i < 5; i++) {
      const res = await loginAttempt("many@example.com", `wrong-${i}`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
    }

    // A correct password STILL logs in — no stuck lockout state.
    const ok = await loginAttempt("many@example.com", "right-pw");
    expect(ok.status).toBe(200);
  });
});
