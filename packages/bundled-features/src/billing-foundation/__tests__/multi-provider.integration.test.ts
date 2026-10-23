// Two providers behind one catalog: provider listing and choice in billing-plans,
// providerName on start-plan-checkout, the switch path that follows the
// subscription's own provider (hosted vs. in-app), and the per-provider VAT note
// in the confirmation mail. Real HTTP through setupTestStack; the providers are
// stubs that record what they were asked.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
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
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { consentTextVersion } from "../consumer-protection/consent-text.ts";
import { CHECKOUT_CONSENT_RECORDED_EVENT_QN } from "../events.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import { subscriptionsProjectionTable } from "../projection.ts";
import type {
  BillingPlanCatalog,
  BillingPlansResult,
  ConsumerProtectionOptions,
  PaymentEvent,
  ProviderPrice,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.ts";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  SubscriptionStatuses,
} from "../web/constants.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";

const HOSTED = "mock-hosted";
const IN_APP = "mock-in-app";
const TERMS_SLUG = "billing-terms";
const BUYER_EMAIL = "buyer@example.com";
const DEFAULT_VAT_NOTE = "Prices include VAT.";
const IN_APP_VAT_NOTE = "VAT is invoiced by the in-app provider.";
const IN_APP_CHECKOUT_NOTE = "The in-app provider is the merchant of record.";

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: DEFAULT_VAT_NOTE },
  operatorEmail: "billing@example.com",
  legalLinks: {
    terms: "/legal/terms",
    withdrawal: "/legal/withdrawal",
    privacy: "https://example.com/privacy",
  },
  providerTexts: {
    [IN_APP]: {
      vatNote: { de: "USt. stellt der In-App-Anbieter aus.", en: IN_APP_VAT_NOTE },
      checkoutNote: {
        de: "Der In-App-Anbieter ist Verkäufer.",
        en: IN_APP_CHECKOUT_NOTE,
      },
    },
  },
};

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  tierLabelKey: (tier) => `test-mock-multi-hosted:plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async (db, tenantId) => {
    const rows = await db.selectMany(
      subscriptionsProjectionTable,
      { id: subscriptionAggregateId(tenantId) },
      { limit: 1 },
    );
    const row = rows[0];
    const tier = row?.["tier"];
    return row?.["status"] === SubscriptionStatuses.active && typeof tier === "string"
      ? tier
      : "free";
  },
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
};

function price(priceId: string, unitAmount: number): ProviderPrice {
  return {
    priceId,
    unitAmount,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  };
}

type Calls = {
  checkouts: Array<{ provider: string; priceId: string; consentId?: string }>;
  hostedSwitches: string[];
  applies: Array<{ targetPriceId: string; consentId?: string; tenantId: string }>;
};
const calls: Calls = { checkouts: [], hostedSwitches: [], applies: [] };
const enabled = { [HOSTED]: true, [IN_APP]: true };
let lastConsentId: string | undefined;

function plugin(
  name: typeof HOSTED | typeof IN_APP,
  displayName: string,
  prices: readonly ProviderPrice[],
  priceToTier: Readonly<Record<string, string>>,
  extra: Partial<SubscriptionProviderPlugin>,
): SubscriptionProviderPlugin {
  return {
    displayName,
    verifyAndParseWebhook: async (rawBody) =>
      JSON.parse(rawBody) as SubscriptionEvent | PaymentEvent | null,
    priceToTier,
    isBillingEnabled: async () => enabled[name],
    retrievePrices: async (_ctx, priceIds) => prices.filter((p) => priceIds.includes(p.priceId)),
    createCheckoutSession: async (_ctx, options) => {
      lastConsentId = options.consentId;
      calls.checkouts.push({
        provider: name,
        priceId: options.priceId,
        ...(options.consentId && { consentId: options.consentId }),
      });
      return { url: `https://${name}.example/checkout/${options.priceId}` };
    },
    ...extra,
  };
}

const hostedFeature = defineFeature("test-mock-multi-hosted", (r) => {
  r.requires({ features: ["billing-foundation"] });
  r.translations({
    keys: { "plan.starter.label": { en: "Starter" }, "plan.pro.label": { en: "Pro plan" } },
  });
  r.useExtension(
    "subscriptionProvider",
    HOSTED,
    plugin(
      HOSTED,
      "Hosted Pay",
      [price("hosted_starter", 900), price("hosted_pro", 1900)],
      { hosted_starter: "starter", hosted_pro: "pro" },
      {
        createPlanSwitchSession: async (_ctx, options) => {
          calls.hostedSwitches.push(options.targetPriceId);
          return { url: `https://${HOSTED}.example/switch/${options.targetPriceId}` };
        },
      },
    ),
  );
});

const inAppFeature = defineFeature("test-mock-multi-in-app", (r) => {
  r.requires({ features: ["billing-foundation"] });
  r.useExtension(
    "subscriptionProvider",
    IN_APP,
    plugin(
      IN_APP,
      "In-App Pay",
      [price("inapp_starter", 990), price("inapp_pro", 2990)],
      { inapp_starter: "starter", inapp_pro: "pro" },
      {
        previewPlanSwitch: async () => ({
          amountDueNow: 667,
          tax: 106,
          currency: "eur",
          credit: 333,
          effectiveAt: "2026-11-01T10:00:00Z",
        }),
        applyPlanSwitch: async (_ctx, options) => {
          calls.applies.push({
            targetPriceId: options.targetPriceId,
            tenantId: options.tenantId,
            ...(options.consentId && { consentId: options.consentId }),
          });
        },
      },
    ),
  );
});

const emailTransport = createInMemoryTransport();
const configResolver = createConfigResolver();
let stack: TestStack;

beforeAll(async () => {
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
      hostedFeature,
      inAppFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      templateResolver: createTemplateResolverApi(deps.db, deps.registry),
      configResolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, configResolver),
    }),
    extraRoutes: [createSubscriptionWebhookRoute()],
    jobs: { consumerLane: "worker", queueNamePrefix: `multi-provider-${generateId()}` },
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
});

beforeEach(async () => {
  calls.checkouts.length = 0;
  calls.hostedSwitches.length = 0;
  calls.applies.length = 0;
  enabled[HOSTED] = true;
  enabled[IN_APP] = true;
  lastConsentId = undefined;
  emailTransport.sent.length = 0;
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`);
  await resetTestTables(stack.db, [userTable, templateResourcesTable]);
  await seedRowViaEventStore(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: TERMS_SLUG,
    kind: TEXT_BLOCK_KIND,
    locale: "en",
    scope: "system",
    status: "active",
    content: "General terms and conditions, version 1",
    contentFormat: "markdown",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    insertedById: "test",
    modifiedById: "test",
  });
  await seedNotificationTemplates(stack.db, stack.registry);
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function consent() {
  return {
    earlyPerformanceRequested: true,
    withdrawalLossAcknowledged: true,
    consentTextVersion: consentTextVersion("en"),
    locale: "en",
  };
}

async function plansOf(admin: ReturnType<typeof adminFor>): Promise<BillingPlansResult> {
  return (await stack.http.queryOk(
    "billing-foundation:query:billing-plans",
    {},
    admin,
  )) as BillingPlansResult;
}

async function createSubscription(
  tenantId: string,
  providerName: string,
  tier: "starter" | "pro" = "starter",
) {
  const admin = createTestUser({ id: 0, tenantId, roles: ["TenantAdmin", "SystemAdmin"] });
  await stack.http.writeOk(
    SubscriptionFoundationHandlers.processEvent,
    {
      providerEventId: `evt_${tenantId}_create`,
      providerName,
      type: "subscription.created",
      providerCustomerId: `cus_${tenantId}`,
      providerSubscriptionId: `sub_${tenantId}`,
      status: SubscriptionStatuses.active,
      tier,
      currentPeriodEndIso: "2026-06-01T00:00:00Z",
    },
    admin,
  );
}

describe("billing-plans with two providers", () => {
  test("both offered: providers lists each with its display name, note and own prices; plans are the first provider's", async () => {
    const result = await plansOf(adminFor(8301));
    expect(result.providers?.map((p) => p.name)).toEqual([HOSTED, IN_APP]);
    expect(result.providers?.map((p) => p.displayName)).toEqual(["Hosted Pay", "In-App Pay"]);
    expect(result.providers?.[0]?.note).toBeUndefined();
    expect(result.providers?.[1]?.note).toEqual({
      de: "Der In-App-Anbieter ist Verkäufer.",
      en: IN_APP_CHECKOUT_NOTE,
    });
    expect(result.providers?.[0]?.plans.map((p) => p.price?.unitAmount)).toEqual([900, 1900]);
    expect(result.providers?.[1]?.plans.map((p) => p.price?.unitAmount)).toEqual([990, 2990]);
    expect(result.plans).toEqual(result.providers?.[0]?.plans ?? []);
  });

  test("only one provider offered and it has no note: the old shape without providers", async () => {
    enabled[IN_APP] = false;
    const result = await plansOf(adminFor(8302));
    expect(result.providers).toBeUndefined();
    expect(result.plans.map((p) => p.price?.unitAmount)).toEqual([900, 1900]);
  });

  test("only the provider with a checkout note is offered: providers carries it so the note shows", async () => {
    enabled[HOSTED] = false;
    const result = await plansOf(adminFor(8303));
    expect(result.providers?.map((p) => p.name)).toEqual([IN_APP]);
    expect(result.plans.map((p) => p.price?.unitAmount)).toEqual([990, 2990]);
  });

  test("a tenant with a subscription sees only the holder's plans, without providers", async () => {
    const admin = adminFor(8304);
    await createSubscription(admin.tenantId, IN_APP);
    const result = await plansOf(admin);
    expect(result.providers).toBeUndefined();
    expect(result.plans.map((p) => p.price?.unitAmount)).toEqual([990, 2990]);
    expect(result.inAppPlanSwitch).toBe(true);
    expect(result.plans.find((p) => p.tier === "pro")?.action).toBe("switch");
  });
});

describe("start-plan-checkout with two providers", () => {
  test("providerName routes the checkout to that provider's price and records it on the consent", async () => {
    const admin = adminFor(8310);
    const reply = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", providerName: IN_APP, consent: consent() },
      admin,
    )) as { url: string };
    expect(reply.url).toBe(`https://${IN_APP}.example/checkout/inapp_pro`);
    expect(calls.checkouts).toEqual([
      { provider: IN_APP, priceId: "inapp_pro", consentId: lastConsentId },
    ]);
    const events = await loadAggregate(
      stack.db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId as never,
      {
        includeArchived: true,
      },
    );
    const consentEvent = events.find((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN);
    expect(consentEvent?.payload).toMatchObject({ providerName: IN_APP });
  });

  test("omitting providerName with two offered providers is rejected, opening no checkout", async () => {
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consent() },
      adminFor(8311),
    );
    expect(error.i18nKey).toBe("billing-foundation.errors.providerRequired");
    expect(calls.checkouts).toHaveLength(0);
  });

  test("a provider that is not offered right now is rejected", async () => {
    enabled[IN_APP] = false;
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", providerName: IN_APP, consent: consent() },
      adminFor(8312),
    );
    expect(error.i18nKey).toBe("billing-foundation.errors.providerNotOffered");
    expect(calls.checkouts).toHaveLength(0);
  });

  test("omitting providerName with exactly one offered provider still works", async () => {
    enabled[IN_APP] = false;
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consent() },
      adminFor(8313),
    );
    expect(calls.checkouts.map((c) => c.provider)).toEqual([HOSTED]);
  });
});

describe("switching plans follows the subscription's provider", () => {
  test("a hosted-switch provider answers a url and needs no consent", async () => {
    const admin = adminFor(8320);
    await createSubscription(admin.tenantId, HOSTED);
    const reply = await stack.http.writeOk(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro" },
      admin,
    );
    expect(reply).toEqual({ url: `https://${HOSTED}.example/switch/hosted_pro` });
    expect(calls.applies).toHaveLength(0);
  });

  test("plan-switch-preview answers the provider's proration and the target price", async () => {
    const admin = adminFor(8321);
    await createSubscription(admin.tenantId, IN_APP);
    const reply = await stack.http.queryOk(
      SubscriptionFoundationQueries.planSwitchPreview,
      { tier: "pro" },
      admin,
    );
    expect(reply).toEqual({
      preview: {
        amountDueNow: 667,
        tax: 106,
        currency: "eur",
        credit: 333,
        effectiveAt: "2026-11-01T10:00:00Z",
      },
      target: {
        tier: "pro",
        unitAmount: 2990,
        currency: "eur",
        interval: "month",
        intervalCount: 1,
      },
    });
  });

  test("plan-switch-preview on a hosted-switch provider is rejected", async () => {
    const admin = adminFor(8322);
    await createSubscription(admin.tenantId, HOSTED);
    const error = await stack.http.queryErr(
      SubscriptionFoundationQueries.planSwitchPreview,
      { tier: "pro" },
      admin,
    );
    expect(error.i18nKey).toBe("billing-foundation.errors.planSwitchNotSupported");
  });

  test("the in-app switch without a consent is rejected and applies nothing", async () => {
    const admin = adminFor(8323);
    await createSubscription(admin.tenantId, IN_APP);
    await stack.http.writeErr(SubscriptionFoundationHandlers.switchPlan, { tier: "pro" }, admin);
    expect(calls.applies).toHaveLength(0);
  });

  test("the in-app switch with a consent records it and applies with the consentId", async () => {
    const admin = adminFor(8324);
    await createSubscription(admin.tenantId, IN_APP);
    const reply = await stack.http.writeOk(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro", consent: consent() },
      admin,
    );
    expect(reply).toEqual({ applied: true });
    expect(calls.applies).toEqual([
      { targetPriceId: "inapp_pro", tenantId: admin.tenantId, consentId: expect.any(String) },
    ]);
    const events = await loadAggregate(
      stack.db,
      subscriptionAggregateId(admin.tenantId),
      admin.tenantId as never,
      {
        includeArchived: true,
      },
    );
    const consentEvent = events.find((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN);
    expect(consentEvent?.payload).toMatchObject({
      tier: "pro",
      providerName: IN_APP,
      consentId: calls.applies[0]?.consentId,
    });
  });
});

describe("confirmation mail names the provider's own VAT note", () => {
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

  async function activateAndMail(providerName: string, tenantNumber: number): Promise<string> {
    const buyer = await createBuyer(tenantNumber);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", providerName, consent: consent() },
      buyer,
    );
    const body: SubscriptionEvent = {
      providerEventId: `evt_${tenantNumber}`,
      providerName,
      type: SubscriptionEventTypes.created,
      tenantId: buyer.tenantId,
      providerCustomerId: "cus_mail",
      providerSubscriptionId: "sub_mail",
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEnd: "2026-11-02T00:00:00Z",
      ...(lastConsentId !== undefined && { consentId: lastConsentId }),
    };
    const res = await stack.app.request(`/api/subscription/webhook/${providerName}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "stripe-signature": "test_sig" },
    });
    expect(res.status).toBe(200);
    await stack.drainJobs();
    expect(emailTransport.sent).toHaveLength(1);
    return emailTransport.sent[0]?.html ?? "";
  }

  test("a purchase through the in-app provider carries its VAT note instead of the default", async () => {
    const html = await activateAndMail(IN_APP, 8330);
    expect(html).toContain(IN_APP_VAT_NOTE);
    expect(html).not.toContain(DEFAULT_VAT_NOTE);
  });

  test("a purchase through a provider without its own text carries the default VAT note", async () => {
    const html = await activateAndMail(HOSTED, 8331);
    expect(html).toContain(DEFAULT_VAT_NOTE);
    expect(html).not.toContain(IN_APP_VAT_NOTE);
  });
});
