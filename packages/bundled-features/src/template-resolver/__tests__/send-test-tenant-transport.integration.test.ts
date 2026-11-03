// A test mail must leave through the transport the real notification takes: a tenant with its
// own mail provider gets the test mail from that provider, not from the app transport.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { runAsAgentToolCallEntry } from "@cosmicdrift/kumiko-framework/internal/request-context";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { ConfigHandlers } from "../../config/web/constants.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { maskRecipientAddress } from "../../delivery/mask-recipient-address.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import { createMailFoundationFeature } from "../../mail-foundation/feature.ts";
import { tenantMailTransport } from "../../mail-foundation/index.ts";
import {
  clearInbox,
  createMailTransportInMemoryFeature,
  getInbox,
} from "../../mail-transport-inmemory/index.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { seedNotificationTemplates } from "../seeding.ts";
import { templateResourceEntity } from "../table.ts";
import { TEST_MAIL_NOTIFICATION_TYPE } from "../web/constants.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";

const LOCALE = "en";
const TENANT_ROUTED_SLUG = "status-mailer:notify:incident";
const STANDALONE_DRAFT_SLUG = "status-mailer:mail:standalone-draft";
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
      createTemplateResolverFeature({
        tenantEditable: [TENANT_ROUTED_SLUG, APP_ROUTED_SLUG, STANDALONE_DRAFT_SLUG].map(
          (slug) => ({ kind: "mail", slug, access: { roles: ["TenantAdmin"] } }),
        ),
      }),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createMailFoundationFeature(),
      createMailTransportInMemoryFeature(),
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
      configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
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
  appTransport.failNext = null;
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
        slug: STANDALONE_DRAFT_SLUG,
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

describe("template-resolver :: send-test leaves an audit trail", () => {
  const attemptsOf = async () =>
    (await selectMany(stack.db, deliveryAttemptsTable, {
      notificationType: TEST_MAIL_NOTIFICATION_TYPE,
      recipientId: adminWithProvider.id,
    })) as Array<{
      channel: string;
      status: string;
      error: string | null;
      recipientAddress: string | null;
    }>;
  const sendTestPayload = { slug: APP_ROUTED_SLUG, locale: LOCALE };
  const sendTestAsAgentToolCall = () =>
    runAsAgentToolCallEntry(() =>
      stack.dispatcher.write(TemplateResolverHandlers.sendTest, sendTestPayload, adminWithProvider),
    );

  test("a failed test mail stays logged although the handler transaction rolls back", async () => {
    const before = (await attemptsOf()).length;
    appTransport.failNext = { message: "smtp refused" };

    const error = await stack.http.writeErr(
      TemplateResolverHandlers.sendTest,
      sendTestPayload,
      adminWithProvider,
    );

    expectErrorIncludes(error, "template_test_mail_failed");
    const attempts = await attemptsOf();
    expect(attempts).toHaveLength(before + 1);
    expect(attempts.at(-1)).toMatchObject({
      channel: "email",
      status: "failed",
      error: "channel_error",
    });
  });

  test("an agent tool call sends the test mail and logs the attempt", async () => {
    const before = (await attemptsOf()).length;

    const result = await sendTestAsAgentToolCall();

    expect(result.isSuccess).toBe(true);
    expect(appTransport.sent.map((message) => message.to)).toEqual([
      addressOf(adminWithProvider.id),
    ]);
    const attempts = await attemptsOf();
    expect(attempts).toHaveLength(before + 1);
    expect(attempts.at(-1)).toMatchObject({ channel: "email", status: "sent", error: null });
  });

  test("a failed test mail from an agent tool call stays logged", async () => {
    const before = (await attemptsOf()).length;
    appTransport.failNext = { message: "smtp refused" };

    const result = await sendTestAsAgentToolCall();

    expect(result.isSuccess).toBe(false);
    const attempts = await attemptsOf();
    expect(attempts).toHaveLength(before + 1);
    expect(attempts.at(-1)).toMatchObject({
      channel: "email",
      status: "failed",
      error: "channel_error",
    });
  });

  test("a sent test mail is logged as a delivery attempt with a masked address", async () => {
    const before = (await attemptsOf()).length;

    await stack.http.writeOk(
      TemplateResolverHandlers.sendTest,
      { slug: APP_ROUTED_SLUG, locale: LOCALE },
      adminWithProvider,
    );

    const attempts = await attemptsOf();
    expect(attempts).toHaveLength(before + 1);
    const attempt = attempts.at(-1);
    expect(attempt).toMatchObject({ channel: "email", status: "sent", error: null });
    expect(attempt?.recipientAddress).toBe(maskRecipientAddress(addressOf(adminWithProvider.id)));
    expect(attempt?.recipientAddress).not.toBe(addressOf(adminWithProvider.id));
  });
});

describe("template-resolver :: usage names the notification's transport", () => {
  type Usage = { usedBy: Array<{ qualifiedName: string; tenantTransport: boolean }> };

  test("the editor learns which mail sends from the tenant's own provider", async () => {
    const usageOf = (slug: string) =>
      stack.http.queryOk<Usage>(
        TemplateResolverQueries.usage,
        { slug, kind: "mail" },
        adminWithProvider,
      );
    expect((await usageOf(TENANT_ROUTED_SLUG)).usedBy).toEqual([
      expect.objectContaining({ qualifiedName: TENANT_ROUTED_SLUG, tenantTransport: true }),
    ]);
    expect((await usageOf(APP_ROUTED_SLUG)).usedBy).toEqual([
      expect.objectContaining({ qualifiedName: APP_ROUTED_SLUG, tenantTransport: false }),
    ]);
  });
});
