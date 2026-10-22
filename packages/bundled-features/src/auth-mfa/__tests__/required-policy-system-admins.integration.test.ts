// Under requiredPolicy "systemAdmins" only a user holding the global SystemAdmin
// role must enroll; a TenantAdmin without enrollment logs in normally.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { asRawClient, configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { seedUser } from "../../user/seeding.ts";
import { createAuthMfaFeature } from "../feature.ts";
import { mfaStatusCheckerFromFeature } from "../feature-exports.ts";
import { userMfaEntity } from "../schema/user-mfa.ts";
import { AuthMfaHandlers } from "../web/constants.ts";

let stack: TestStack;

const TENANT_ID: TenantId = testTenantId(433);
const PASSWORD = "correct-horse-battery-2026"; // gitleaks:allow fake login password for the seeded test user

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  configureEntityFieldEncryption(encryption);
  const authMfaFeature = createAuthMfaFeature({
    setupTokenSecret: "test-mfa-setup-token-secret-at-least-32-bytes!!",
    issuer: "Kumiko Test",
    challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
    requiredPolicy: "systemAdmins",
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
});

async function seedAndLogin(
  email: string,
  globalRoles: readonly string[],
  membershipRoles: readonly string[],
): Promise<{ mfaSetupRequired?: boolean; token?: string }> {
  const { id } = await seedUser(stack.db, {
    email,
    displayName: "Policy User",
    passwordHash: await hashPassword(PASSWORD),
    emailVerified: true,
    roles: globalRoles,
  });
  await seedTenantMembership(stack.db, { userId: id, tenantId: TENANT_ID, roles: membershipRoles });
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.json();
}

describe("auth-mfa systemAdmins policy", () => {
  test("an unenrolled SystemAdmin gets the setup step, no session", async () => {
    const body = await seedAndLogin("sysadmin@example.com", [ROLES.SystemAdmin], ["User"]);

    expect(body.mfaSetupRequired).toBe(true);
    expect(body.token).toBeUndefined();
  });

  test("an unenrolled TenantAdmin logs in normally", async () => {
    const body = await seedAndLogin("tenantadmin@example.com", [], [ROLES.TenantAdmin]);

    expect(body.mfaSetupRequired).toBeUndefined();
    expect(typeof body.token).toBe("string");
  });
});
