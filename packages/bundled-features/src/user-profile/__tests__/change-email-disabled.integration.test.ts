// user-profile with allowEmailChange: false — the change-email write handler
// is not registered, so the route cannot be reached even by a signed-in user.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/constants.js";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.js";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createDataRetentionFeature } from "../../data-retention/index.js";
import { createFilesFeature } from "../../files/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { createUserFeature } from "../../user/feature.js";
import { createUserDataRightsFeature } from "../../user-data-rights/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.js";
import { UserProfileHandlers } from "../constants.js";
import { createUserProfileFeature } from "../feature.js";

const TENANT = testTenantId(1);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createFilesFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      createUserProfileFeature({ allowEmailChange: false }),
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("user-profile with allowEmailChange: false", () => {
  test("change-email is not a registered handler: the write is rejected", async () => {
    const signedIn = createTestUser({ tenantId: TENANT, roles: ["User"] });
    const error = await stack.http.writeErr(
      UserProfileHandlers.changeEmail,
      { currentPassword: "secret-pw-1", newEmail: "other@example.com" },
      signedIn,
    );
    expect(error.httpStatus).toBeGreaterThanOrEqual(400);
    expect(stack.registry.getWriteHandler(UserProfileHandlers.changeEmail)).toBeUndefined();
  });
});
