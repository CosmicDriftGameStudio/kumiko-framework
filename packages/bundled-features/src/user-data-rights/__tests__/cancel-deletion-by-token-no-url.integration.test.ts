// Without deletionCancelUrl the deletion-requested mail must not carry a cancel link.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import type { SendDeletionRequestedEmailFn } from "../handlers/request-deletion.write.ts";
import { UserDataRightsHandlers } from "../web/constants.ts";

const tenantA = testTenantId(1);
const aliceUser = createTestUser({ id: 42, tenantId: tenantA, roles: ["Member"] });

const mails: Parameters<SendDeletionRequestedEmailFn>[0][] = [];
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature({
        deletionTokenSecret: "cancel-token-test-secret-0123456789abcdef",
        sendDeletionRequestedEmail: async (args) => {
          mails.push(args);
        },
      }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  mails.length = 0;
  await resetTestTables(stack.db, [userTable, tenantComplianceProfileTable, eventsTable]);
});

test("deletion-requested mail has no cancelUrl when the app sets no deletionCancelUrl", async () => {
  await seedRowViaEventStore(stack.db, userTable, {
    id: aliceUser.id,
    email: "alice.nourl@example.com",
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    gracePeriodEnd: null,
  });
  await stack.http.writeOk(UserDataRightsHandlers.requestDeletion, {}, aliceUser);

  expect(mails).toHaveLength(1);
  expect(mails[0]?.cancelUrl).toBeUndefined();
});
