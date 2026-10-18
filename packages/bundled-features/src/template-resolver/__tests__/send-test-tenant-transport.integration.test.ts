// A test mail must leave through the transport the real notification takes: a tenant with its
// own mail provider gets the test mail from that provider, not from the app transport.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { ConfigHandlers } from "../../config/constants.js";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.js";
import { mailFoundationFeature } from "../../mail-foundation/feature.js";
import { tenantMailTransport } from "../../mail-foundation/index.js";
import {
  clearInbox,
  getInbox,
  mailTransportInMemoryFeature,
} from "../../mail-transport-inmemory/index.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity } from "../../user/schema/user.js";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers } from "../qualified-names.js";
import { seedNotificationTemplates } from "../seeding.js";
import { templateResourceEntity } from "../table.js";

const LOCALE = "en";
const TENANT_ROUTED_SLUG = "status-mailer:notify:incident";
const APP_ROUTED_SLUG = "status-mailer:notify:account-notice";
const appTransport = createInMemoryTransport();
const addressOf = (userId: string): string => `${userId}@send-test.test`;

const statusMailer = defineFeature("status-mailer", (r) => {
  const template = { en: { body: "<p>Something happened.</p>" } };
  const meta = { en: { subject: "Status update" } };
  r.notification("incident", { tenantTransport: true, template, meta });
  r.notification("account-notice", { template, meta });
});

const tenantWithProvider = testTenantId(701);
const adminWithProvider = createTestUser({
  id: 701,
  roles: ["TenantAdmin"],
  tenantId: tenantWithProvider,
});

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      mailFoundationFeature,
      mailTransportInMemoryFeature,
      createChannelEmailFeature({
        transport: appTransport,
        tenantTransport: tenantMailTransport,
        resolveEmail: async (userId) => addressOf(userId),
      }),
      statusMailer,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    deliveryAttemptsTable,
  });
  await seedNotificationTemplates(stack.db, stack.registry);
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: "mail-foundation:config:provider", value: "inmemory" },
    adminWithProvider,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  appTransport.sent.length = 0;
  clearInbox(tenantWithProvider);
});

describe("template-resolver :: send-test through the notification's transport", () => {
  test("a tenant-routed notification's test mail leaves through the tenant's provider", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { slug: TENANT_ROUTED_SLUG, locale: LOCALE },
      adminWithProvider,
    );
    expect(getInbox(tenantWithProvider).map((message) => message.to)).toEqual([
      addressOf(adminWithProvider.id),
    ]);
    expect(appTransport.sent).toHaveLength(0);
  });

  test("an app-routed notification's test mail leaves through the app transport", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { slug: APP_ROUTED_SLUG, locale: LOCALE },
      adminWithProvider,
    );
    expect(appTransport.sent.map((message) => message.to)).toEqual([
      addressOf(adminWithProvider.id),
    ]);
    expect(getInbox(tenantWithProvider)).toHaveLength(0);
  });

  test("a draft whose slug is no notification leaves through the app transport", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      {
        slug: "status-mailer:mail:standalone-draft",
        locale: LOCALE,
        content: "<p>Draft body.</p>",
        meta: { subject: "Draft" },
      },
      adminWithProvider,
    );
    expect(appTransport.sent.map((message) => message.to)).toEqual([
      addressOf(adminWithProvider.id),
    ]);
    expect(getInbox(tenantWithProvider)).toHaveLength(0);
  });
});
