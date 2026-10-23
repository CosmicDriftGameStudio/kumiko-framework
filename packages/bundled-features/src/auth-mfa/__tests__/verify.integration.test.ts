import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { asRawClient, configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import {
  createAnonymousUser,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTestEnvelopeCipher,
  deleteRowViaEventStore,
  expectErrorIncludes,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers as AuthEmailPasswordHandlers } from "../../auth-email-password/web/constants.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../../tenant-lifecycle/lifecycle-gate.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { base32Decode } from "../base32.ts";
import { createAuthMfaFeature } from "../feature.ts";
import { mfaStatusCheckerFromFeature } from "../feature-exports.ts";
import { signMfaChallengeToken } from "../mfa-challenge-token.ts";
import { userMfaEntity } from "../schema/user-mfa.ts";
import { currentTotpCode } from "../totp.ts";
import { AuthMfaHandlers } from "../web/constants.ts";

let stack: TestStack;

const SETUP_TOKEN_SECRET = "test-mfa-setup-secret-at-least-32-bytes-long!!";
const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";

// Handler access is `{ roles: ["anonymous"] }`, matching how the framework
// route dispatches with the anonymous identity — a literal here is enough
// since the handler derives everything from the challenge-token payload,
// not from event.user.
const GUEST: SessionUser = createAnonymousUser("00000000-0000-4000-8000-000000000001" as TenantId);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher();
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
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      authMfaFeature,
      createAuthEmailPasswordFeature({
        mfaStatusChecker: mfaStatusCheckerFromFeature(authMfaFeature),
      }),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthEmailPasswordHandlers.login,
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function enableMfaFor(
  idSeed: number,
  userRowOverrides: Record<string, unknown> = {},
): Promise<{
  user: ReturnType<typeof createTestUser>;
  secret: Buffer;
  recoveryCodes: string[];
  password: string;
}> {
  const user = createTestUser({ id: idSeed, roles: ["User"] });
  const password = `password-${idSeed}-long-enough`;
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
  // verify.write.ts re-checks tenant membership AND the user's own row
  // (status gate) the way login.write.ts does — auth-mfa never writes a
  // read_users row itself (enableStart/enableConfirm only touch user-mfa),
  // so both need seeding here, not just per-test where a scenario cares.
  await seedRowViaEventStore(stack.db, tenantMembershipsTable, {
    userId: user.id,
    tenantId: user.tenantId,
    roles: JSON.stringify(["User"]),
  });
  await seedRowViaEventStore(stack.db, userTable, {
    id: user.id,
    email: `user-${user.id}@example.com`,
    passwordHash: await hashPassword(password),
    displayName: `Test User ${idSeed}`,
    locale: "de",
    emailVerified: true,
    roles: "[]",
    status: USER_STATUS.Active,
    ...userRowOverrides,
  });
  return { user, secret, recoveryCodes: start.recoveryCodes, password };
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

  test("a password login followed by MFA verify retains the user's timezone", async () => {
    const { user, password, secret } = await enableMfaFor(9, { timezone: "Europe/Berlin" });

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: `user-${user.id}@example.com`,
      password,
    });
    expect(loginRes.status).toBe(200);
    const login = (await loginRes.json()) as { challengeToken?: string };
    expect(login.challengeToken).toBeTypeOf("string");
    if (!login.challengeToken) throw new Error("MFA login did not return a challenge token");

    const verified = await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken: login.challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expect(verified.session.timezone).toBe("Europe/Berlin");
  });

  test("a password login followed by MFA verify omits an unset timezone", async () => {
    const { user, password, secret } = await enableMfaFor(10);

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: `user-${user.id}@example.com`,
      password,
    });
    expect(loginRes.status).toBe(200);
    const login = (await loginRes.json()) as { challengeToken?: string };
    expect(login.challengeToken).toBeTypeOf("string");
    if (!login.challengeToken) throw new Error("MFA login did not return a challenge token");

    const verified = await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken: login.challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expect(verified.session.timezone).toBeUndefined();
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

  test("an exact-duplicate verify (same challenge token, same code) is rejected", async () => {
    const { user, secret } = await enableMfaFor(4);
    const challengeToken = challengeFor(user.id, user.tenantId);

    await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );

    // Same challenge token, same (still time-window-valid) code — rejected
    // by the TOTP-counter burn inside verifyMfaFactor before the challenge-
    // token burn is even reached (that burn now happens after success).
    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_totp_code");
  });

  test("a TOTP code cannot be replayed across a FRESH challenge token (RFC 6238 §5.2)", async () => {
    const { user, secret } = await enableMfaFor(105);
    const code = currentTotpCode(secret);

    const challengeA = challengeFor(user.id, user.tenantId);
    await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken: challengeA, code },
      GUEST,
    );

    // A DIFFERENT challenge token (as a real re-login would mint) but the
    // SAME still-time-window-valid code — this is the actual attack this
    // finding is about: a phished/shoulder-surfed code used for a parallel
    // login, not a naive replay of the whole prior request.
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

describe("mfa verify — re-checks account state the way login.write.ts does", () => {
  test("membership revoked between login and verify → challenge rejected, no fallback to global roles", async () => {
    const { user, secret } = await enableMfaFor(5);
    const challengeToken = challengeFor(user.id, user.tenantId);

    // Simulate the membership being pulled after the challenge token was
    // issued but before verify runs — the exact gap login.write.ts's
    // noMembership() guards against.
    await asRawClient(stack.db).unsafe(
      `DELETE FROM "${tenantMembershipsTable.tableName}" WHERE user_id = $1 AND tenant_id = $2`,
      [user.id, user.tenantId],
    );

    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_challenge_token");
  });

  test("account restricted between login and verify → challenge rejected", async () => {
    const { user, secret } = await enableMfaFor(6, { status: USER_STATUS.Restricted });
    const challengeToken = challengeFor(user.id, user.tenantId);

    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_challenge_token");
  });

  test("user row deleted between login and verify → challenge rejected (the !userRow gate)", async () => {
    const { user, secret } = await enableMfaFor(7);
    const challengeToken = challengeFor(user.id, user.tenantId);

    // Simulate the read_users row disappearing after the challenge token
    // was issued but before verify runs — hits verify.write.ts's
    // `if (!userRow) return invalidChallengeToken()` gate directly, distinct
    // from a revoked membership or a restricted-but-present user row.
    await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}" WHERE id = $1`, [
      user.id,
    ]);

    const err = await stack.http.writeErr(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expectErrorIncludes(err, "invalid_challenge_token");
  });

  test("tenant enters teardown between login and verify → challenge rejected", async () => {
    const { user, secret } = await enableMfaFor(11);
    const challengeToken = challengeFor(user.id, user.tenantId);

    // user.tenantId is the shared default test tenant (TestUsers.admin) —
    // restore it to "active" afterwards so later tests reusing it aren't affected.
    await seedRowViaEventStore(stack.db, tenantTable, {
      id: user.tenantId,
      tenantId: user.tenantId,
      key: `t-${user.tenantId.slice(-8)}`,
      name: "Tenant",
      status: "destroying",
    });
    resetTenantLifecycleGateCacheForTests();

    try {
      // Via the dispatcher, not HTTP: the request-level teardown gate answers
      // 410 before /api/write reaches the handler, and this test asserts the
      // handler's own challenge-token gate.
      const result = await stack.dispatcher.write(
        AuthMfaHandlers.verify,
        { challengeToken, code: currentTotpCode(secret) },
        GUEST,
      );
      if (result.isSuccess) throw new Error("expected mfa verify to fail");
      expectErrorIncludes(result.error, "invalid_challenge_token");
    } finally {
      await deleteRowViaEventStore(
        stack.db,
        { table: tenantTable, entity: tenantEntity, entityName: "tenant" },
        { id: user.tenantId },
        { tenantId: user.tenantId },
      );
      resetTenantLifecycleGateCacheForTests();
    }
  });

  test("user row homed in a DIFFERENT tenant than the challenge → verify succeeds (#1235)", async () => {
    const { user, secret } = await enableMfaFor(8);

    // Re-home the read_users row into another tenant — the layout where:
    // the user entity is tenant-agnostic (systemStream), so its row's
    // tenant_id need not match the tenant being logged into. The old
    // tenant-scoped UserQueries.detail lookup returned null here and every
    // verify died with invalid_challenge_token; the unscoped findForAuth
    // must resolve the row regardless.
    await asRawClient(stack.db).unsafe(
      `UPDATE "${userTable.tableName}" SET tenant_id = $1 WHERE id = $2`,
      ["00000000-0000-4000-8000-0000000000fe", user.id],
    );

    const challengeToken = challengeFor(user.id, user.tenantId);
    const res = await stack.http.writeOk<{ session: SessionUser }>(
      AuthMfaHandlers.verify,
      { challengeToken, code: currentTotpCode(secret) },
      GUEST,
    );
    expect(res.session.id).toBe(user.id);
    expect(res.session.tenantId).toBe(user.tenantId);
  });
});
