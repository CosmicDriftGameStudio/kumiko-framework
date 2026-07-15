import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  expectErrorIncludes,
} from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity } from "../../user/schema/user";
import { base32Decode } from "../base32";
import { AuthMfaHandlers } from "../constants";
import { createAuthMfaFeature } from "../feature";
import { signMfaChallengeToken } from "../mfa-challenge-token";
import { userMfaEntity } from "../schema/user-mfa";
import { currentTotpCode } from "../totp";

let stack: TestStack;

const SETUP_TOKEN_SECRET = "test-mfa-setup-secret-at-least-32-bytes-long!!";
const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";

// Handler access is `{ roles: ["all"] }`, matching how the framework route
// dispatches with a guest identity — a literal here is enough since the
// handler derives everything from the challenge-token payload, not from
// event.user.
const GUEST: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  tenantId: "00000000-0000-4000-8000-000000000001" as TenantId,
  roles: ["all"],
};

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
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
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function enableMfaFor(idSeed: number): Promise<{
  user: ReturnType<typeof createTestUser>;
  secret: Buffer;
  recoveryCodes: string[];
}> {
  const user = createTestUser({ id: idSeed, roles: ["User"] });
  const start = await stack.http.writeOk<{
    setupToken: string;
    otpauthUri: string;
    recoveryCodes: string[];
  }>(AuthMfaHandlers.enableStart, { accountLabel: `user-${idSeed}@example.com` }, user);
  const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
  const secret = base32Decode(secretParam);
  await stack.http.writeOk(
    AuthMfaHandlers.enableConfirm,
    { setupToken: start.setupToken, code: currentTotpCode(secret) },
    user,
  );
  return { user, secret, recoveryCodes: start.recoveryCodes };
}

function challengeFor(userId: string, tenantId: TenantId): string {
  return signMfaChallengeToken({ userId, tenantId }, 10, CHALLENGE_TOKEN_SECRET).token;
}

describe("mfa verify — completes a two-step login", () => {
  test("a valid TOTP code succeeds and returns the full session", async () => {
    const { user, secret } = await enableMfaFor(1);
    const challengeToken = challengeFor(user.id, user.tenantId);

    const res = await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expect(res.session.id).toBe(user.id);
    expect(res.session.tenantId).toBe(user.tenantId);
  });

  test("a wrong TOTP code is rejected", async () => {
    const { user } = await enableMfaFor(2);
    const challengeToken = challengeFor(user.id, user.tenantId);
    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken, code: "000000" },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_totp_code");
  });

  test("a valid recovery code succeeds, and the SAME code is rejected on replay", async () => {
    const { user, recoveryCodes } = await enableMfaFor(3);
    const code = recoveryCodes[0];
    if (code === undefined) throw new Error("no recovery code minted");

    const challengeA = challengeFor(user.id, user.tenantId);
    const res = await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken: challengeA, code },
      GUEST,
    );
    expect(res.session.id).toBe(user.id);

    // Advisor-flagged trap: a recovery code must be single-use. Re-verify
    // with a FRESH challenge token (a real attacker would just re-login)
    // but the SAME recovery code — it must now be rejected because
    // verify.write.ts persists remainingHashes on the row.
    const challengeB = challengeFor(user.id, user.tenantId);
    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken: challengeB, code },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_totp_code");
  });

  test("a malformed challenge token is rejected without leaking account state", async () => {
    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken: "not-a-real-token", code: "123456" },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_challenge_token");
  });

  test("a challenge token for a user without MFA enabled is rejected", async () => {
    const challengeToken = challengeFor("verify-never-enabled-1", GUEST.tenantId);
    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken, code: "123456" },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_challenge_token");
  });
});
