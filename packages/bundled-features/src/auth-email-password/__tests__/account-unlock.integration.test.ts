// Account-unlock integration tests (#1266) — the self-service escape hatch
// for the account-lockout monotonic counter: after a lock expires, the next
// wrong password immediately re-locks (see account-lockout.integration.test.ts
// "expired lock + wrong password → immediate re-lock"). This flow gives a
// legitimate user a way out via mailbox-ownership proof instead of being
// stuck retrying.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { hashPassword } from "../../shared";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
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
import { signUnlockToken } from "../unlock-token";

const emailTransport = createInMemoryTransport();

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;
const encryptionKey = randomBytes(32).toString("base64");
const unlockSecret = randomBytes(32).toString("base64");
const appUnlockUrl = "https://app.example.com/unlock-account";

const MAX_ATTEMPTS = 3;
const LOCK_MINUTES = 1;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        accountLockout: {
          maxFailedAttempts: MAX_ATTEMPTS,
          lockoutDurationMinutes: LOCK_MINUTES,
        },
        accountUnlock: { hmacSecret: unlockSecret, tokenTtlMinutes: 15, appUrl: appUnlockUrl },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
        [AuthErrors.accountLocked]: 423,
      },
      accountUnlock: {
        requestHandler: AuthHandlers.requestAccountUnlock,
        confirmHandler: AuthHandlers.confirmAccountUnlock,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await stack.redis.flushNamespace();
  emailTransport.sent.length = 0;
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
  await seedTenantMembership(stack.db, { userId: created.id, tenantId, roles: ["User"] });
  return { id: created.id, tenantId };
}

async function loginAttempt(email: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password });
}

async function post(path: string, body: unknown): Promise<Response> {
  return stack.http.raw("POST", path, body);
}

async function readLockoutState(userId: string): Promise<LockoutState | null> {
  return getLockoutState(stack.redis.redis, userId);
}

async function lockAccount(email: string): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await loginAttempt(email, `wrong-${i}`);
  }
}

describe("POST /auth/request-account-unlock", () => {
  test("known email → 200, delivery sends mail with unlock URL", async () => {
    await seedLoginUser("alice@example.com", "initial-pw!");

    const res = await post("/api/auth/request-account-unlock", { email: "alice@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no email sent");
    expect(sent.to).toBe("alice@example.com");
    expect(sent.html).toContain(`${appUnlockUrl}?token=`);
  });

  test("unknown email → 200 with NO mail sent (enumeration-safe)", async () => {
    const res = await post("/api/auth/request-account-unlock", { email: "ghost@example.com" });

    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(0);
  });
});

describe("POST /auth/confirm-account-unlock", () => {
  test("valid token on a locked account → clears failureCount AND lockedUntil", async () => {
    const seed = await seedLoginUser("bob@example.com", "right-pw");
    await lockAccount("bob@example.com");
    expect((await readLockoutState(seed.id))?.lockedUntil).not.toBeNull();

    const { token } = signUnlockToken(seed.id, 15, unlockSecret);
    const res = await post("/api/auth/confirm-account-unlock", { token });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
    expect(await readLockoutState(seed.id)).toBeNull();
  });

  // This is the actual bug fix from #1266: the monotonic counter otherwise
  // re-locks on the very next wrong password once the lock window expires.
  // Confirming the unlock token must clear the COUNT key, not just the
  // until key — otherwise the escape hatch doesn't actually escape anything.
  test("after unlock, a subsequent wrong password does NOT immediately re-lock", async () => {
    const seed = await seedLoginUser("carol@example.com", "right-pw");
    await lockAccount("carol@example.com");

    const { token } = signUnlockToken(seed.id, 15, unlockSecret);
    await post("/api/auth/confirm-account-unlock", { token });

    const res = await loginAttempt("carol@example.com", "still-wrong-once");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);

    const state = await readLockoutState(seed.id);
    expect(state?.failureCount).toBe(1);
    expect(state?.lockedUntil).toBeNull();
  });

  test("unlocked account can log in again with the correct password", async () => {
    const seed = await seedLoginUser("dana@example.com", "right-pw");
    await lockAccount("dana@example.com");

    const { token } = signUnlockToken(seed.id, 15, unlockSecret);
    await post("/api/auth/confirm-account-unlock", { token });

    const res = await loginAttempt("dana@example.com", "right-pw");
    expect(res.status).toBe(200);
  });

  test("confirming on a non-locked account is a harmless no-op", async () => {
    const seed = await seedLoginUser("erin@example.com", "right-pw");

    const { token } = signUnlockToken(seed.id, 15, unlockSecret);
    const res = await post("/api/auth/confirm-account-unlock", { token });

    expect(res.status).toBe(200);
    expect(await readLockoutState(seed.id)).toBeNull();
  });

  test("replaying the same unlock token twice is harmless (no burn-store)", async () => {
    const seed = await seedLoginUser("frank@example.com", "right-pw");
    await lockAccount("frank@example.com");

    const { token } = signUnlockToken(seed.id, 15, unlockSecret);
    const res1 = await post("/api/auth/confirm-account-unlock", { token });
    const res2 = await post("/api/auth/confirm-account-unlock", { token });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  test("tampered token → 422 invalid_unlock_token; lockout state untouched", async () => {
    const seed = await seedLoginUser("greta@example.com", "right-pw");
    await lockAccount("greta@example.com");
    const { token } = signUnlockToken(seed.id, 15, unlockSecret);
    const tampered = `${token.slice(0, -3)}XXX`;

    const res = await post("/api/auth/confirm-account-unlock", { token: tampered });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidUnlockToken);
    expect((await readLockoutState(seed.id))?.lockedUntil).not.toBeNull();
  });

  test("token signed with a different secret → 422", async () => {
    const seed = await seedLoginUser("henry@example.com", "right-pw");
    const { token } = signUnlockToken(seed.id, 15, "wrong-secret-wrong-secret-wrong!!");

    const res = await post("/api/auth/confirm-account-unlock", { token });

    expect(res.status).toBe(422);
  });

  test("expired token → 422 invalid_unlock_token", async () => {
    const seed = await seedLoginUser("iris@example.com", "right-pw");
    const past = Temporal.Now.instant().subtract({ minutes: 30 });
    const { token } = signUnlockToken(seed.id, 15, unlockSecret, past);

    const res = await post("/api/auth/confirm-account-unlock", { token });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidUnlockToken);
  });

  test("malformed body → 400 invalid_body", async () => {
    const res = await post("/api/auth/confirm-account-unlock", { wrong: "shape" });
    expect(res.status).toBe(400);
  });
});
