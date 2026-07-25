// #1467: verify / enable-confirm / enable-confirm-preauth used to silently
// skip their brute-force cap and single-use burn when ctx.redis was
// unavailable, instead of failing closed. Real HTTP through setupTestStack
// with redis explicitly unwired (same pattern as
// auth-email-password/__tests__/account-lockout-no-redis.integration.test.ts),
// asserting each handler now returns an internal_error instead of silently
// degrading and continuing to the TOTP check.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { createTenantFeature } from "../../tenant";
import { createUserFeature } from "../../user/feature";
import { base32Encode } from "../base32";
import { AuthMfaHandlers } from "../constants";
import { createAuthMfaFeature } from "../feature";
import { signMfaChallengeToken } from "../mfa-challenge-token";
import { signMfaSetupToken } from "../mfa-setup-token";
import { userMfaEntity } from "../schema/user-mfa";
import { generateTotpSecret } from "../totp";

let stack: TestStack;

const CHALLENGE_TOKEN_SECRET = "no-redis-test-challenge-token-secret-not-real-0001";
const SETUP_TOKEN_SECRET = "no-redis-test-setup-token-secret-not-real-0002";
const TENANT_ID: TenantId = testTenantId(421);

// Mirrors framework's auth-routes.ts GUEST_USER — verify/enable-confirm-preauth
// are guest-callable (access: { roles: ["all"] }), the real identity comes
// entirely from the signed token, not from this dispatch-level user.
const GUEST_USER: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  tenantId: SYSTEM_TENANT_ID,
  roles: ["all"],
};

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthMfaFeature({
        setupTokenSecret: SETUP_TOKEN_SECRET,
        issuer: "Kumiko Test",
        challengeTokenSecret: CHALLENGE_TOKEN_SECRET,
      }),
    ],
    // extraContext runs after the default `redis: testRedis.redis` spread —
    // setting redis:undefined here overrides it on the handler-facing
    // AppContext (see account-lockout-no-redis.integration.test.ts).
    extraContext: () => ({
      configResolver: resolver,
      configEncryption: encryption,
      redis: undefined,
    }),
  });

  await unsafeCreateEntityTable(stack.db, userMfaEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("auth-mfa handlers — ctx.redis unset (#1467)", () => {
  test("verify: fails closed with internal_error instead of skipping the brute-force cap/burn", async () => {
    const user = createTestUser({ tenantId: TENANT_ID });
    const { token } = signMfaChallengeToken(
      { userId: user.id, tenantId: TENANT_ID },
      5,
      CHALLENGE_TOKEN_SECRET,
    );

    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken: token, code: "123456" },
      GUEST_USER,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(500);
    expect(err.code).toBe("internal_error");
    expect(err.message).toContain("requires ctx.redis");
  });

  test("enable-confirm-preauth: fails closed with internal_error instead of skipping the brute-force cap/burn", async () => {
    const user = createTestUser({ tenantId: TENANT_ID });
    const { token } = signMfaSetupToken(
      {
        userId: user.id,
        tenantId: TENANT_ID,
        totpSecretBase32: base32Encode(generateTotpSecret()),
        recoveryCodeHashes: [],
      },
      5,
      SETUP_TOKEN_SECRET,
    );

    const err = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirmPreauth,
      { setupToken: token, code: "123456" },
      GUEST_USER,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(500);
    expect(err.code).toBe("internal_error");
    expect(err.message).toContain("requires ctx.redis");
  });

  test("enable-confirm: fails closed with internal_error instead of skipping the single-use burn", async () => {
    const user = createTestUser({ tenantId: TENANT_ID });
    const { token } = signMfaSetupToken(
      {
        userId: user.id,
        totpSecretBase32: base32Encode(generateTotpSecret()),
        recoveryCodeHashes: [],
      },
      5,
      SETUP_TOKEN_SECRET,
    );

    const err = await stack.http.writeErr(
      AuthMfaHandlers.enableConfirm,
      { setupToken: token, code: "123456" },
      user,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(500);
    expect(err.code).toBe("internal_error");
    expect(err.message).toContain("requires ctx.redis");
  });
});
