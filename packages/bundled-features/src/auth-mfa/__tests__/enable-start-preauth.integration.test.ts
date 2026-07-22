// #1465: a user blocked at login by MFA enforcement (mfa-setup-required,
// see #1455) can generate a TOTP secret + QR without a session, using the
// preauthSetupToken login.write.ts issued. Real HTTP through
// setupTestStack, exercising the full chain: login → preauthSetupToken →
// POST /auth/mfa/preauth-enable-start → a setupToken that #1456's
// (not-yet-built) confirm step will consume via verifyMfaSetupToken.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
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
import { signMfaPreauthSetupToken } from "../mfa-preauth-setup-token";
import { verifyMfaSetupToken } from "../mfa-setup-token";
import { userMfaEntity } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

let stack: TestStack;

const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";
const SETUP_TOKEN_SECRET = "test-mfa-setup-token-secret-at-least-32-bytes!!";
const TENANT_ID: TenantId = testTenantId(410);

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

async function loginBlockedByEnforcement(): Promise<{
  preauthSetupToken: string;
  userId: string;
}> {
  const password = "correct-horse-battery-2026";
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: "unenrolled@example.com", passwordHash: hash, displayName: "Unenrolled" },
    createTestUser({ id: 411, tenantId: TENANT_ID, roles: ["SystemAdmin"] }),
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT_ID,
    roles: ["User"],
  });
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: mfaRequiredConfigHandle.name, value: "all" },
    createTestUser({ id: 412, tenantId: TENANT_ID, roles: ["Admin"] }),
  );

  const loginRes = await stack.http.raw("POST", "/api/auth/login", {
    email: "unenrolled@example.com",
    password,
  });
  const loginBody = await loginRes.json();
  return { preauthSetupToken: loginBody.preauthSetupToken as string, userId: created.id };
}

describe("POST /auth/mfa/preauth-enable-start", () => {
  test("generates a TOTP secret + QR from a valid preauthSetupToken, no session minted", async () => {
    const { preauthSetupToken } = await loginBlockedByEnforcement();

    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-enable-start", {
      preauthSetupToken,
      accountLabel: "unenrolled@example.com",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.token).toBeUndefined();
    expect(typeof body.setupToken).toBe("string");
    expect(typeof body.otpauthUri).toBe("string");
    expect(body.otpauthUri).toContain("otpauth://totp/");
    expect(Array.isArray(body.recoveryCodes)).toBe(true);
    expect(body.recoveryCodes).toHaveLength(8);

    // The returned setupToken must compose with the EXISTING enable-confirm
    // verification path (verifyMfaSetupToken) — proves #1465 and #1456
    // actually chain together, not just that each returns *a* string.
    const verified = verifyMfaSetupToken(body.setupToken, SETUP_TOKEN_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(typeof verified.payload.totpSecretBase32).toBe("string");
      expect(verified.payload.recoveryCodeHashes).toHaveLength(8);
    }
  });

  test("expired/garbage preauthSetupToken → invalid_challenge_token, no secret leaked", async () => {
    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-enable-start", {
      preauthSetupToken: "not-a-real-token",
      accountLabel: "unenrolled@example.com",
    });

    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.setupToken).toBeUndefined();
  });

  test("already-enrolled user gets mfa_already_enabled, not a fresh secret", async () => {
    const { userId } = await loginBlockedByEnforcement();
    const sessionUser = createTestUser({ id: userId, tenantId: TENANT_ID, roles: ["User"] });

    // Really enrolls — via the existing session-authed enable-start/confirm
    // pair, not a synthetic DB insert — so this test breaks if enrollment
    // detection ever drifts from what a real enroll actually persists.
    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "unenrolled@example.com" },
      sessionUser,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      sessionUser,
    );

    // A fresh preauthSetupToken for the SAME already-enrolled user — the
    // login flow itself would no longer issue one (mfaStatusChecker sees
    // the row and returns `required: true`, not `setupRequired`), so this
    // mints one directly to isolate the handler's own already-enrolled
    // check from that unrelated login-side branch.
    const { token: freshPreauthToken } = signMfaPreauthSetupToken(
      { userId, tenantId: TENANT_ID },
      10,
      CHALLENGE_TOKEN_SECRET,
    );

    const res = await stack.http.raw("POST", "/api/auth/mfa/preauth-enable-start", {
      preauthSetupToken: freshPreauthToken,
      accountLabel: "unenrolled@example.com",
    });

    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
    expect(body.error.details.reason).toBe("mfa_already_enabled");
    expect(body.setupToken).toBeUndefined();
  });
});
