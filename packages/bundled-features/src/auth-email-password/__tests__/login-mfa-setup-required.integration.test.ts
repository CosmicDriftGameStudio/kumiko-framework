// #1455: enforcement policy blocks an unenrolled user at login
// (mfa-setup-required) — the response must carry a preauthSetupToken so a
// later pre-auth enroll step (#1231) can look the user back up without a
// session. Real HTTP through setupTestStack, both auth-mfa and
// auth-email-password mounted together (mirrors auth.integration.test.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
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
  createAuthMfaFeature,
  mfaRequiredConfigHandle,
  mfaStatusCheckerFromFeature,
} from "../../auth-mfa";
import { userMfaEntity } from "../../auth-mfa/schema/user-mfa";
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
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;

const CHALLENGE_TOKEN_SECRET = "test-mfa-challenge-secret-at-least-32-bytes!!";
const TENANT_ID: TenantId = testTenantId(400);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
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

    const { verifyMfaPreauthSetupToken } = await import("../../auth-mfa/mfa-preauth-setup-token");
    const verified = verifyMfaPreauthSetupToken(body.preauthSetupToken, CHALLENGE_TOKEN_SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toEqual({ userId: created.id, tenantId: TENANT_ID });
    }
  });
});
