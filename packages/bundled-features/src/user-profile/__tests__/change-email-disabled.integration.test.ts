// user-profile with allowEmailChange: false — the change-email write handler
// is not registered, so the route cannot be reached even by a signed-in user.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createFilesFeature } from "../../files/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/index.ts";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.ts";
import { createUserProfileFeature } from "../feature.ts";
import { UserProfileHandlers } from "../web/constants.ts";

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
      createAuthFoundationFeature(),
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
