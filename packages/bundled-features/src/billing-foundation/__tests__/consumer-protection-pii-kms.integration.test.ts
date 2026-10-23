// With an active PII KMS the stored user email is ciphertext. The consumer
// protection mails (§ 312f confirmation, termination receipt) must reach the
// in-memory transport addressed to the plaintext address; channel-email refuses
// ciphertext recipients, so a regression shows up as a missing mail.
// KMS is global module state, hence a file of its own.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configuredPiiSubjectKms,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferenceEntity } from "../../delivery/tables.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverApi } from "../../template-resolver/api.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { seedNotificationTemplates } from "../../template-resolver/seeding.ts";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.ts";
import { SYSTEM_TENANT_ID, TEXT_BLOCK_KIND } from "../../template-resolver/web/constants.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { consentTextVersion } from "../consumer-protection/consent-text.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.ts";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../web/constants.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";

const PROVIDER = "mock-pii-kms-provider";
const TERMS_SLUG = "billing-terms";
const BUYER_EMAIL = "buyer.kms@example.com";
const PII_CIPHERTEXT_PREFIX = "kumiko-pii:";

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
  operatorEmail: "billing@example.com",
  legalLinks: {
    terms: "/legal/terms",
    withdrawal: "/legal/withdrawal",
    privacy: "https://example.com/privacy",
  },
};

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  tierLabelKey: (tier) => `test-mock-pii-kms-provider:plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async () => "free",
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  providerName: PROVIDER,
};

const emailTransport = createInMemoryTransport();
const configResolver = createConfigResolver();
let lastConsentId: string | undefined;

const mockProviderFeature = defineFeature("test-mock-pii-kms-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  r.translations({ keys: { "plan.pro.label": { en: "Pro plan" } } });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    retrievePrices: async (_ctx, priceIds) =>
      [
        {
          priceId: "price_pro",
          unitAmount: 1900,
          currency: "eur",
          interval: "month" as const,
          intervalCount: 1,
          active: true,
          metadata: {},
        },
      ].filter((price) => priceIds.includes(price.priceId)),
    createCheckoutSession: async (_ctx, options) => {
      lastConsentId = options.consentId;
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
    cancelSubscription: async () => {},
  };
  r.useExtension("subscriptionProvider", PROVIDER, plugin);
});

let stack: TestStack;

beforeAll(async () => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createBillingFoundationFeature({
        baseUrl: "https://app.example.com",
        catalog,
        consumerProtection,
      }),
      mockProviderFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      templateResolver: createTemplateResolverApi(deps.db, deps.registry),
      configResolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, configResolver),
    }),
    extraRoutes: [createSubscriptionWebhookRoute()],
    jobs: { consumerLane: "worker", queueNamePrefix: `pii-kms-${generateId()}` },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, notificationPreferenceEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  emailTransport.sent.length = 0;
  lastConsentId = undefined;
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`,
  );
  await resetTestTables(stack.db, [userTable, templateResourcesTable]);
  await seedNotificationTemplates(stack.db, stack.registry);
  await seedRow(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: TERMS_SLUG,
    kind: TEXT_BLOCK_KIND,
    locale: "de",
    scope: "system",
    status: "active",
    content: "Allgemeine Geschäftsbedingungen",
    contentFormat: "markdown",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    insertedById: "test",
    modifiedById: "test",
  });
});

async function createBuyer(tenantNumber: number) {
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: BUYER_EMAIL, passwordHash: "not-a-real-hash", displayName: "Buyer" },
    TestUsers.systemAdmin,
  );
  return createTestUser({
    id: created.id,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function postSubscriptionCreated(
  tenantId: string,
  providerEventId: string,
  consentId?: string,
): Promise<void> {
  const event: SubscriptionEvent = {
    providerEventId,
    providerName: PROVIDER,
    type: SubscriptionEventTypes.created,
    tenantId,
    providerCustomerId: "cus_kms",
    providerSubscriptionId: "sub_kms",
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2026-11-02T00:00:00Z",
    ...(consentId !== undefined && { consentId }),
  };
  const res = await stack.app.request(`/api/subscription/webhook/${PROVIDER}`, {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "stripe-signature": "test_sig" },
  });
  expect(res.status).toBe(200);
}

describe("consumer protection mails with an active PII KMS", () => {
  test("the stored user email really is ciphertext (guards the premise of the other tests)", async () => {
    await createBuyer(8301);
    const rows = await asRawClient(stack.db).unsafe<{ email: string }>(
      `SELECT email FROM "${userTable.tableName}"`,
    );
    expect(rows[0]?.email.startsWith(PII_CIPHERTEXT_PREFIX)).toBe(true);
  });

  test("the contract confirmation goes to the plaintext address of the buyer", async () => {
    const buyer = await createBuyer(8302);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      {
        tier: "pro",
        consent: {
          earlyPerformanceRequested: true,
          withdrawalLossAcknowledged: true,
          consentTextVersion: consentTextVersion("de"),
          locale: "de",
        },
      },
      buyer,
    );
    if (lastConsentId === undefined) throw new Error("provider did not receive a consentId");

    await postSubscriptionCreated(buyer.tenantId, "evt_kms_1", lastConsentId);
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    expect(emailTransport.sent[0]?.to).toBe(BUYER_EMAIL);
    expect(emailTransport.sent[0]?.subject).toBe("Vertragsbestätigung");
  });

  test("the termination receipt goes to the plaintext address and never leaks ciphertext into the mail", async () => {
    const buyer = await createBuyer(8303);
    await postSubscriptionCreated(buyer.tenantId, "evt_kms_2");

    await stack.http.writeOk(
      SubscriptionFoundationHandlers.terminateContract,
      { declarationType: "termination", terminationKind: "ordinary" },
      buyer,
    );
    await stack.drainJobs();

    const receipts = emailTransport.sent.filter((mail) => mail.to === BUYER_EMAIL);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.html).not.toContain(PII_CIPHERTEXT_PREFIX);
    expect(receipts[0]?.text).not.toContain(PII_CIPHERTEXT_PREFIX);
  });

  test("an erased subject gets no confirmation mail", async () => {
    const buyer = await createBuyer(8304);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      {
        tier: "pro",
        consent: {
          earlyPerformanceRequested: true,
          withdrawalLossAcknowledged: true,
          consentTextVersion: consentTextVersion("de"),
          locale: "de",
        },
      },
      buyer,
    );
    if (lastConsentId === undefined) throw new Error("provider did not receive a consentId");

    await configuredPiiSubjectKms()?.eraseKey(
      { kind: "user", userId: buyer.id },
      { requestId: "consumer-protection-pii-kms", userId: buyer.id, eraseReason: "test" },
    );
    await postSubscriptionCreated(buyer.tenantId, "evt_kms_3", lastConsentId);
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(0);
  });

  test("an erased subject cannot terminate by mail and gets no receipt", async () => {
    const buyer = await createBuyer(8305);
    await postSubscriptionCreated(buyer.tenantId, "evt_kms_4");

    await configuredPiiSubjectKms()?.eraseKey(
      { kind: "user", userId: buyer.id },
      { requestId: "consumer-protection-pii-kms", userId: buyer.id, eraseReason: "test" },
    );
    await stack.http.writeErr(
      SubscriptionFoundationHandlers.terminateContract,
      { declarationType: "termination", terminationKind: "ordinary" },
      buyer,
    );
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(0);
  });
});
