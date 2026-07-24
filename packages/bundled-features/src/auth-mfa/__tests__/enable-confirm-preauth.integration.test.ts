// #1456: completes both the enrollment #1465 started AND the login that
// mfa-setup-required blocked. Real HTTP through setupTestStack, exercising
// the full chain: login → preauthSetupToken → preauth-enable-start →
// preauth-confirm → the minted JWT actually authenticates a follow-up
// request. That end-to-end seam is the thing a mocked test would fake.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import {
  AuthErrors as AuthEmailPasswordErrors,
  AuthHandlers as AuthEmailPasswordHandlers,
  createAuthEmailPasswordFeature,
} from "../../auth-email-password";
import { ConfigHandlers, createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { hashPassword } from "../../shared";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/testing";
import { UserHandlers } from "../../user";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { mfaRequiredConfigHandle } from "../config";
import { AuthMfaHandlers } from "../constants";
import { createAuthMfaFeature, mfaStatusCheckerFromFeature } from "../feature";
import { userMfaEntity, userMfaTable } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

let stack: TestStack;

const CHALLENGE_TOKEN_SECRET = "integration-test-challenge-token-secret-not-real-0001";
const SETUP_TOKEN_SECRET = "integration-test-setup-token-secret-not-real-0002";
const TENANT_ID: TenantId = testTenantId(420);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  const authMfaFeature = createAuthMfaFeature({
    setupTokenSecret: SETUP_TOKEN_SECRET,
    issuer: "Kumiko Test",
    challengeTokenSecret: CHALLENGE_TOKEN_SECRET,
  });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      authMfaFeature,
      createAuthEmailPasswordFeature({
        mfaStatusChecker: mfaStatusCheckerFromFeature(authMfaFeature),
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthEmailPasswordHandlers.login,
      loginErrorStatusMap: {
        [AuthEmailPasswordErrors.invalidCredentials]: 401,
        [AuthEmailPasswordErrors.noMembership]: 403,
      },
      mfaPreauthEnableStartHandler: AuthMfaHandlers.enableStartPreauth,
      mfaPreauthConfirmHandler: AuthMfaHandlers.enableConfirmPreauth,
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
});

async function loginBlockedByEnforcement(
  email = "unenrolled@example.com",
): Promise<{ preauthSetupToken: string; userId: string }> {
  const password = "correct-horse-battery-2026";
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: "Unenrolled" },
    createTestUser({ id: 421, tenantId: TENANT_ID, roles: ["SystemAdmin"] }),
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT_ID,
    roles: ["User"],
  });
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: mfaRequiredConfigHandle.name, value: "all" },
    createTestUser({ id: 422, tenantId: TENANT_ID, roles: ["Admin"] }),
  );

  const loginRes = await stack.http.raw("POST", "/api/auth/login", { email, password });
  const loginBody = await loginRes.json();
  return { preauthSetupToken: loginBody.preauthSetupToken as string, userId: created.id };
}

async function startEnrollment(
  preauthSetupToken: string,
  accountLabel: string,
): Promise<{ setupToken: string; secret: Buffer }> {
  const startRes = await stack.http.raw("POST", "/api/auth/mfa/preauth-enable-start", {
    preauthSetupToken,
    accountLabel,
  });
  const startBody = await startRes.json();
  const secretParam = new URLSearchParams(startBody.otpauthUri.split("?")[1]).get("secret") ?? "";
  return { setupToken: startBody.setupToken as string, secret: base32Decode(secretParam) };
}

describe("POST /auth/mfa/preauth-confirm", () => {
  test("completes enrollment + login: full chain, minted JWT authenticates a follow-up request", async () => {
    const email = "chain@example.com";
    const { preauthSetupToken } = await loginBlockedByEnforcement(email);
    const { setupToken, secret } = await startEnrollment(preauthSetupToken, email);

    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken,
      code: currentTotpCode(secret),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.user.tenantId).toBe(TENANT_ID);

    // The proof that matters: the minted JWT actually authenticates.
    const meRes = await stack.http.raw(
      "POST",
      "/api/query",
      { type: "user:query:user:me", payload: {} },
      { Authorization: `Bearer ${body.token}` },
    );
    expect(meRes.status).toBe(200);
  });

  test("wrong TOTP code → invalid_totp_code, no enrollment persisted", async () => {
    const email = "wrongcode@example.com";
    const { preauthSetupToken, userId } = await loginBlockedByEnforcement(email);
    const { setupToken } = await startEnrollment(preauthSetupToken, email);

    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken,
      code: "000000",
    });

    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.details.reason).toBe("invalid_totp_code");
    expect(body.token).toBeUndefined();
    // "no enrollment persisted" is the actual claim in the test name — the
    // reason string alone doesn't prove it. Scoped to this test's own user:
    // the table isn't truncated between tests in this file.
    const rows = await selectMany(stack.db, userMfaTable, { userId });
    expect(rows).toHaveLength(0);
  });

  test("replaying the same setupToken after a successful confirm → invalid_setup_token (burned), not a second enrollment", async () => {
    const email = "race@example.com";
    const { preauthSetupToken, userId } = await loginBlockedByEnforcement(email);
    const { setupToken, secret } = await startEnrollment(preauthSetupToken, email);
    const code = currentTotpCode(secret);

    const first = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken,
      code,
    });
    expect(first.status).toBe(200);

    // Same setupToken again — this integration stack wires real Redis, so
    // the single-use burn from the first call rejects the replay before it
    // ever reaches the already-enrolled DB check.
    const second = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken,
      code,
    });
    expect(second.status).not.toBe(200);
    const secondBody = await second.json();
    expect(secondBody.error.details.reason).toBe("invalid_setup_token");
    // "not a second enrollment" — pin the row count, not just the error reason.
    const rows = await selectMany(stack.db, userMfaTable, { userId });
    expect(rows).toHaveLength(1);
  });

  test("a session-issued setupToken (no tenantId) is rejected, not silently accepted", async () => {
    const email = "sessionissued@example.com";
    const password = "correct-horse-battery-2026";
    const hash = await hashPassword(password);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email, passwordHash: hash, displayName: "Session Issued" },
      createTestUser({ id: 423, tenantId: TENANT_ID, roles: ["SystemAdmin"] }),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    const sessionUser = createTestUser({ id: created.id, tenantId: TENANT_ID, roles: ["User"] });

    // The session-authed enable-start signs a setupToken with the SAME
    // secret + format, but never carries tenantId (see mfa-setup-token.ts).
    // A malicious or confused client resubmitting it to the pre-auth
    // endpoint must not be able to piggyback on tenantId inference.
    const start = await stack.http.writeOk<{ setupToken: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: email },
      sessionUser,
    );

    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken: start.setupToken,
      code: "123456",
    });

    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.details.reason).toBe("invalid_setup_token");
  });

  test("expired/garbage setupToken → invalid_setup_token, no session minted", async () => {
    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken: "not-a-real-token",
      code: "123456",
    });

    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.token).toBeUndefined();
  });
});
