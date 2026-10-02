// #1455: enforcement policy blocks an unenrolled user at login
// (mfa-setup-required) — the response must carry a preauthSetupToken so a
// later pre-auth enroll step (#1231) can look the user back up without a
// session. Real HTTP through setupTestStack, both auth-mfa and
// auth-email-password mounted together (mirrors auth.integration.test.ts).

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
  AuthMfaHandlers,
  base32Decode,
  createAuthMfaFeature,
  mfaRequiredConfigHandle,
  mfaStatusCheckerFromFeature,
} from "../../auth-mfa/index.js";
import { userMfaEntity } from "../../auth-mfa/schema/user-mfa.js";
import { currentTotpCode } from "../../auth-mfa/totp.js";
import { ConfigHandlers, createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { hashPassword } from "../../shared/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenantMembership } from "../../tenant/testing.js";
import { createUserFeature } from "../../user/feature.js";
import { UserHandlers } from "../../user/index.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { AuthErrors, AuthHandlers } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";

let stack: TestStack;

const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";
const TENANT_ID: TenantId = testTenantId(400);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  configureEntityFieldEncryption(encryption);
  const resolver = createConfigResolver({ cipher: encryption });
  const authMfaFeature = createAuthMfaFeature({
    setupTokenSecret: "test-mfa-setup-token-secret-at-least-32-bytes!!",
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
      loginHandler: AuthHandlers.login,
      mfaPreauthEnableStartHandler: AuthMfaHandlers.enableStartPreauth,
      mfaPreauthConfirmHandler: AuthMfaHandlers.enableConfirmPreauth,
      postAuthLanding: (args) => `/landing/${args.flow}/${args.roles.join(",")}`,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
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

describe("login: mfa-setup-required carries a verifiable preauthSetupToken", () => {
  test("unenrolled user blocked by 'all' policy gets a token instead of a session", async () => {
    const password = "correct-horse-battery-2026";
    const hash = await hashPassword(password);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "unenrolled@example.com", passwordHash: hash, displayName: "Unenrolled" },
      createTestUser({ id: 401, tenantId: TENANT_ID, roles: ["SystemAdmin"] }),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: mfaRequiredConfigHandle.name, value: "all" },
      createTestUser({ id: 402, tenantId: TENANT_ID, roles: ["Admin"] }),
    );

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "unenrolled@example.com",
      password,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.mfaSetupRequired).toBe(true);
    expect(body.token).toBeUndefined();
    expect(typeof body.preauthSetupToken).toBe("string");

    const { verifyMfaPreauthSetupToken } = await import(
      "../../auth-mfa/mfa-preauth-setup-token.js"
    );
    const verified = verifyMfaPreauthSetupToken(body.preauthSetupToken, CHALLENGE_TOKEN_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toEqual({ userId: created.id, tenantId: TENANT_ID });
    }
  });

  // fw#2333 — completing the blocked login via auth-mfa:write:enable-start-
  // preauth + enable-confirm-preauth must carry the user's stored locale
  // into the session it mints, same as a plain login.
  async function completeMfaSetupRequiredLogin(opts: {
    actorId: number;
    email: string;
    locale?: string;
  }): Promise<{ locale?: string; landingPath?: string }> {
    const password = "correct-horse-battery-2026";
    const hash = await hashPassword(password);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: opts.email,
        passwordHash: hash,
        displayName: "Unenrolled",
        ...(opts.locale !== undefined && { locale: opts.locale }),
      },
      createTestUser({ id: opts.actorId, tenantId: TENANT_ID, roles: ["SystemAdmin"] }),
    );
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: mfaRequiredConfigHandle.name, value: "all" },
      createTestUser({ id: opts.actorId + 1, tenantId: TENANT_ID, roles: ["Admin"] }),
    );

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: opts.email,
      password,
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(typeof loginBody.preauthSetupToken).toBe("string");

    const startRes = await stack.http.raw("POST", "/api/auth/mfa/preauth-enable-start", {
      preauthSetupToken: loginBody.preauthSetupToken,
      accountLabel: opts.email,
    });
    expect(startRes.status).toBe(200);
    const start = (await startRes.json()) as { setupToken: string; otpauthUri: string };
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);

    const confirmRes = await stack.http.raw("POST", "/api/auth/mfa/preauth-confirm", {
      setupToken: start.setupToken,
      code: currentTotpCode(secret),
    });
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as {
      isSuccess: boolean;
      token: string;
      landingPath?: string;
    };
    expect(confirmed.isSuccess).toBe(true);
    return {
      ...(await stack.jwt.verify(confirmed.token)),
      ...(confirmed.landingPath !== undefined && { landingPath: confirmed.landingPath }),
    };
  }

  test("completing mfa-setup-required via enable-start/confirm-preauth carries the user's locale", async () => {
    const claims = await completeMfaSetupRequiredLogin({
      actorId: 501,
      email: "preauth-locale@example.com",
      locale: "de-DE",
    });
    expect(claims.locale).toBe("de-DE");
  });

  test("completing mfa-setup-required via enable-start/confirm-preauth without a stored locale omits the claim", async () => {
    const claims = await completeMfaSetupRequiredLogin({
      actorId: 503,
      email: "preauth-nolocale@example.com",
    });
    expect(claims.locale).toBeUndefined();
  });

  test("preauth-confirm consults postAuthLanding with the login flow and the session roles", async () => {
    const result = await completeMfaSetupRequiredLogin({
      actorId: 505,
      email: "preauth-landing@example.com",
    });
    expect(result.landingPath).toBe("/landing/login/User");
  });
});
