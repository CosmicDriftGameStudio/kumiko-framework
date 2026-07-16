// Auth MFA Sample — Integration Test
//
// Drives the wiring from the sample's comment snippet end-to-end against
// real HTTP + DB. If a reader copies the buildServer({...}) block verbatim,
// the resulting app behaves like this test asserts: login is two-step once
// MFA is enabled, and a valid TOTP code completes it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  AuthHandlers,
  createAuthEmailPasswordFeature,
  hashPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  createConfigFeature,
  configValuesTable,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import {
  createUserFeature,
  UserHandlers,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import {
  AuthMfaHandlers,
  base32Decode,
  createAuthMfaFeature,
  currentTotpCode,
  mfaStatusCheckerFromFeature,
  userMfaEntity,
} from "../feature";

const TENANT: TenantId = testTenantId(1);
const SETUP_TOKEN_SECRET = "test-mfa-setup-secret-at-least-32-bytes-long!!";
const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";

let stack: TestStack;

beforeAll(async () => {
  configureEntityFieldEncryption(createTestEnvelopeCipher());

  const mfaFeature = createAuthMfaFeature({
    setupTokenSecret: SETUP_TOKEN_SECRET,
    challengeTokenSecret: CHALLENGE_TOKEN_SECRET,
    issuer: "Kumiko Sample",
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature({
        mfaStatusChecker: mfaStatusCheckerFromFeature(mfaFeature),
      }),
      mfaFeature,
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      mfaVerifyHandler: AuthMfaHandlers.verify,
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
  configureEntityFieldEncryption(undefined);
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
});

describe("auth-mfa sample wiring", () => {
  test("login without MFA enrolled returns a JWT directly", async () => {
    const hash = await hashPassword("super-long-password");
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "plain@example.com", passwordHash: hash, displayName: "Plain" },
      TestUsers.systemAdmin,
    );
    await seedTenantMembership(stack.db, { userId: created.id, tenantId: TENANT, roles: ["User"] });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "plain@example.com",
      password: "super-long-password",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; mfaRequired?: boolean };
    expect(body.token).toBeTypeOf("string");
    expect(body.mfaRequired).toBeUndefined();
  });

  test("login with MFA enrolled challenges, then verify mints the JWT", async () => {
    const hash = await hashPassword("super-long-password");
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "mfa@example.com", passwordHash: hash, displayName: "Mfa" },
      TestUsers.systemAdmin,
    );
    await seedTenantMembership(stack.db, { userId: created.id, tenantId: TENANT, roles: ["User"] });
    const user = { ...TestUsers.user, id: created.id, tenantId: TENANT };

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "mfa@example.com" },
      user,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      user,
    );

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: "mfa@example.com",
      password: "super-long-password",
    });
    expect(loginRes.status).toBe(200);
    const challenge = (await loginRes.json()) as {
      token?: string;
      mfaRequired?: boolean;
      challengeToken?: string;
    };
    expect(challenge.token).toBeUndefined();
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.challengeToken).toBeTypeOf("string");

    const verifyRes = await stack.http.raw("POST", "/api/auth/mfa/verify", {
      challengeToken: challenge.challengeToken,
      code: currentTotpCode(secret),
    });
    expect(verifyRes.status).toBe(200);
    const { token } = (await verifyRes.json()) as { token: string };
    expect(token).toBeTypeOf("string");
  });
});
