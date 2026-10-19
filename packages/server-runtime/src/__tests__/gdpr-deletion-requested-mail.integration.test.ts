// The deletion-requested confirmation goes out through the default mail resolver in the
// session tenant of the user who asks. That user is a member of it, so the membership
// scope of the resolver never swallows the confirmation.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createInMemoryTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
  deliveryAttemptsTable,
  notificationPreferencesTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createFilesFeature } from "@cosmicdrift/kumiko-bundled-features/files";
import { createMailFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import {
  createTenantFeature,
  tenantMembershipEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  USER_STATUS,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createUserDataRightsDefaultsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { resetTestTables, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { resolveMailOption } from "../boot-options/mail-option.ts";

const REQUEST_DELETION = "user-data-rights:write:request-deletion";
const TENANT = testTenantId(1);
const alice = createTestUser({ id: 42, tenantId: TENANT, roles: ["Member"] });
const ALICE_EMAIL = "alice@example.com";

const transport = createInMemoryTransport();
const configResolver = createConfigResolver();
const mail = resolveMailOption(
  { transport },
  { envSource: {}, isProduction: false, authMailFrom: undefined },
);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createFilesFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createMailFoundationFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      mail.feature,
      createUserDataRightsFeature(),
      localeDe(),
      createUserDataRightsDefaultsFeature(),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, configResolver),
    }),
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedNotificationTemplates(stack.db, stack.registry);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, "read_tenant_memberships"]);
  transport.sent.length = 0;
  await seedRow(stack.db, userTable, {
    id: alice.id,
    tenantId: SYSTEM_TENANT_ID,
    email: ALICE_EMAIL,
    passwordHash: "hashed",
    displayName: "Alice",
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
  });
  await seedRow(stack.db, tenantMembershipsTable, {
    tenantId: TENANT,
    userId: alice.id,
    roles: '["Member"]',
  });
});

describe("request-deletion confirmation mail with the default resolver", () => {
  test("reaches the member who requested the deletion", async () => {
    await stack.http.writeOk(REQUEST_DELETION, {}, alice);

    expect(transport.sent.map((message) => message.to)).toEqual([ALICE_EMAIL]);
  });
});
