// The MFA enforcement policy is machine-write-only: a TenantAdmin must not
// relax it, the app default (createAuthMfaFeature({ requiredPolicy })) applies
// without any row, and a system write still overrides it per tenant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import { asRawClient, configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher, expectSuccess } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { ConfigHandlers, createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { mfaRequiredConfigHandle } from "../config.ts";
import { createAuthMfaFeature } from "../feature.ts";
import { mfaStatusCheckerFromFeature } from "../feature-exports.ts";
import { userMfaEntity } from "../schema/user-mfa.ts";
import { AuthMfaHandlers } from "../web/constants.ts";

let stack: TestStack;

const TENANT_ID: TenantId = testTenantId(430);
const PASSWORD = "correct-horse-battery-2026";
const EMAIL = "policy-user@example.com";

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  configureEntityFieldEncryption(encryption);
  const authMfaFeature = createAuthMfaFeature({
    setupTokenSecret: "test-mfa-setup-token-secret-at-least-32-bytes!!",
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
    requiredPolicy: "all",
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
    extraContext: {
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    },
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
  await asRawClient(stack.db).unsafe(`DELETE FROM "${configValuesTable.tableName}"`);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: EMAIL, passwordHash: await hashPassword(PASSWORD), displayName: "Policy User" },
    createTestUser({ id: 431, tenantId: TENANT_ID, roles: ["SystemAdmin"] }),
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT_ID,
    roles: ["User"],
  });
});

async function loginBody(): Promise<{ mfaSetupRequired?: boolean; token?: string }> {
  const res = await stack.http.raw("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.json();
}

describe("auth-mfa required policy", () => {
  test("the app default applies without any config row", async () => {
    const body = await loginBody();
    expect(body.mfaSetupRequired).toBe(true);
    expect(body.token).toBeUndefined();
  });

  test.each([["TenantAdmin"], ["Admin"], ["SystemAdmin"]])(
    "a %s config write over HTTP is rejected with 403 and the policy stays",
    async (role) => {
      const err = await stack.http.writeErr(
        ConfigHandlers.set,
        { key: mfaRequiredConfigHandle.name, value: "optional" },
        createTestUser({ id: 432, tenantId: TENANT_ID, roles: [role] }),
      );
      expect(err.httpStatus).toBe(403);
      expect((await loginBody()).mfaSetupRequired).toBe(true);
    },
  );

  test("a system write overrides the app default for that tenant", async () => {
    expectSuccess(
      await stack.dispatcher.write(
        ConfigHandlers.set,
        { key: mfaRequiredConfigHandle.name, value: "optional" },
        createSystemUser(TENANT_ID),
      ),
    );
    const body = await loginBody();
    expect(body.mfaSetupRequired).toBeUndefined();
    expect(typeof body.token).toBe("string");
  });
});
