// Consent gate on checkout: real HTTP writes through setupTestStack,
// a stub provider that records what createCheckoutSession received, and the
// event stream read back from the event store.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferenceEntity } from "../../delivery/tables.js";
import { createTemplateResolverApi } from "../../template-resolver/api.js";
import { SYSTEM_TENANT_ID, TEXT_BLOCK_KIND } from "../../template-resolver/constants.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import { createUserFeature } from "../../user/feature.js";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.js";
import { SubscriptionFoundationHandlers, SubscriptionStatuses } from "../constants.js";
import { consentTextVersion } from "../consumer-protection/consent-text.js";
import { CHECKOUT_CONSENT_RECORDED_EVENT_QN } from "../events.js";
import { createBillingFoundationFeature } from "../feature.js";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionProviderPlugin,
} from "../types.js";

const TERMS_SLUG = "billing-terms";
const TERMS_CONTENT_DE = "Allgemeine Geschäftsbedingungen, Fassung 1";

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
  operatorEmail: "billing@example.com",
  oneOffItemLabel: async (_ctx, priceId) =>
    priceId === "price_topup"
      ? { labelKey: "shop:pack.credits", params: { count: 500, name: "Pack" } }
      : undefined,
  legalLinks: {
    terms: "/legal/terms",
    withdrawal: "/legal/withdrawal",
    privacy: "https://example.com/privacy",
  },
};

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  tierLabelKey: (tier) => `plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async () => "free",
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  providerName: "mock-consent-provider",
};

type CheckoutCall = {
  priceId: string;
  mode?: string;
  consentId?: string;
  locale?: string;
  submitMessage?: string;
};
const checkoutCalls: CheckoutCall[] = [];
let providerThrows = false;
let billingEnabled = true;

const mockProviderFeature = defineFeature("test-mock-consent-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    oneOffPriceIds: ["price_topup", "price_unlisted"],
    isBillingEnabled: async () => billingEnabled,
    retrievePrices: async (_ctx, priceIds) =>
      [
        {
          priceId: "price_starter",
          unitAmount: 900,
          currency: "eur",
          interval: "month" as const,
          intervalCount: 1,
          active: true,
          metadata: {},
        },
        {
          priceId: "price_pro",
          unitAmount: 1900,
          currency: "eur",
          interval: "month" as const,
          intervalCount: 1,
          active: true,
          metadata: {},
        },
        {
          priceId: "price_topup",
          unitAmount: 500,
          currency: "eur",
          interval: null,
          intervalCount: null,
          active: true,
          metadata: {},
        },
      ].filter((p) => priceIds.includes(p.priceId)),
    createCheckoutSession: async (_ctx, options) => {
      if (providerThrows) throw new Error("provider down");
      checkoutCalls.push({
        priceId: options.priceId,
        ...(options.mode && { mode: options.mode }),
        ...(options.consentId && { consentId: options.consentId }),
        ...(options.locale && { locale: options.locale }),
        ...(options.submitMessage && { submitMessage: options.submitMessage }),
      });
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
  };
  r.useExtension("subscriptionProvider", "mock-consent-provider", plugin);
});

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
      createDeliveryFeature(),
      createBillingFoundationFeature({
        baseUrl: "https://app.example.com",
        catalog,
        consumerProtection,
      }),
      mockProviderFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      templateResolver: createTemplateResolverApi(deps.db),
    }),
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, notificationPreferenceEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  checkoutCalls.length = 0;
  providerThrows = false;
  billingEnabled = true;
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`);
  await stack.db.unsafe?.(`DELETE FROM "${templateResourcesTable.tableName}"`);
  await seedTerms("de", TERMS_CONTENT_DE);
});

async function seedTerms(locale: string, content: string): Promise<void> {
  await seedRow(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: TERMS_SLUG,
    kind: TEXT_BLOCK_KIND,
    locale,
    scope: "system",
    status: "active",
    content,
    contentFormat: "markdown",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    insertedById: "test",
    modifiedById: "test",
  });
}

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function consentFor(locale: string, version = consentTextVersion("de")) {
  return {
    earlyPerformanceRequested: true,
    withdrawalLossAcknowledged: true,
    consentTextVersion: version,
    locale,
  };
}

async function consentEvents(aggregateId: string, tenantId: string) {
  const events = await loadAggregate(stack.db, aggregateId, tenantId as never, {
    includeArchived: true,
  });
  return events.filter((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN);
}

const PAYMENT_BODY = {
  providerName: "mock-consent-provider",
  priceId: "price_topup",
  successUrl: "https://app.example.com/billing/success",
  cancelUrl: "https://app.example.com/billing/cancel",
  mode: "payment",
} as const;

describe("consumerProtection on — start-plan-checkout", () => {
  test("rejects a missing consent and a consent with an unchecked box, opens no checkout", async () => {
    const admin = adminFor(8101);
    const missing = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    );
    const unchecked = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: { ...consentFor("de"), withdrawalLossAcknowledged: false } },
      admin,
    );
    expect(missing.httpStatus).toBe(422);
    expect(JSON.stringify(missing)).toContain("consent_required");
    expect(unchecked.httpStatus).toBe(422);
    expect(JSON.stringify(unchecked)).toContain("consent_required");
    expect(checkoutCalls).toHaveLength(0);
    expect(await consentEvents(subscriptionAggregateId(admin.tenantId), admin.tenantId)).toEqual(
      [],
    );
  });

  test("records exactly one consent on the subscription stream and hands the same consentId to the provider", async () => {
    const admin = adminFor(8102);
    const version = consentTextVersion("de");
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentFor("de-AT", version) },
      admin,
    );

    expect(checkoutCalls).toHaveLength(1);
    const call = checkoutCalls[0];
    expect(call?.locale).toBe("de");
    expect(call?.submitMessage).toContain("Abonnement");

    const events = await consentEvents(subscriptionAggregateId(admin.tenantId), admin.tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      consentId: call?.consentId,
      mode: "subscription",
      tier: "pro",
      priceId: "price_pro",
      unitAmount: 1900,
      currency: "eur",
      interval: "month",
      intervalCount: 1,
      consentTextVersion: version,
      termsHash: createHash("sha256").update(TERMS_CONTENT_DE).digest("hex"),
      termsTemplateVersion: 1,
      locale: "de",
      actorUserId: String(admin.id),
    });
  });

  test("rejects an outdated consent text version without recording or opening a checkout", async () => {
    const admin = adminFor(8103);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentFor("de", "0000000000000000") },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("consent_text_outdated");
    expect(checkoutCalls).toHaveLength(0);
    expect(await consentEvents(subscriptionAggregateId(admin.tenantId), admin.tenantId)).toEqual(
      [],
    );
  });

  test("rejects with terms_unavailable when the terms block does not exist", async () => {
    await stack.db.unsafe?.(`DELETE FROM "${templateResourcesTable.tableName}"`);
    const admin = adminFor(8104);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentFor("de") },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("terms_unavailable");
    expect(checkoutCalls).toHaveLength(0);
    expect(await consentEvents(subscriptionAggregateId(admin.tenantId), admin.tenantId)).toEqual(
      [],
    );
  });

  test("records nothing when the provider fails", async () => {
    providerThrows = true;
    const admin = adminFor(8105);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentFor("de") },
      admin,
    );
    expect(error.httpStatus).toBe(500);
    expect(await consentEvents(subscriptionAggregateId(admin.tenantId), admin.tenantId)).toEqual(
      [],
    );
  });
});

describe("consumerProtection on — create-checkout-session", () => {
  test("payment mode records the consent on the payment stream with the payment submit message", async () => {
    const admin = adminFor(8106);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.createCheckoutSession,
      { ...PAYMENT_BODY, consent: consentFor("en", consentTextVersion("en")) },
      admin,
    );

    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]?.submitMessage).toContain("one-off");
    const events = await consentEvents(paymentAggregateId(admin.tenantId), admin.tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      consentId: checkoutCalls[0]?.consentId,
      mode: "payment",
      tier: null,
      priceId: "price_topup",
      unitAmount: 500,
      interval: null,
      locale: "en",
    });
    expect(await consentEvents(subscriptionAggregateId(admin.tenantId), admin.tenantId)).toEqual(
      [],
    );
  });

  test("requires the consent in payment mode", async () => {
    const admin = adminFor(8107);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      PAYMENT_BODY,
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("consent_required");
    expect(checkoutCalls).toHaveLength(0);
  });
});

describe("consumerProtection on — create-checkout-session gate order", () => {
  const SUBSCRIPTION_BODY = {
    providerName: "mock-consent-provider",
    priceId: "price_pro",
    successUrl: "https://app.example.com/billing/success",
    cancelUrl: "https://app.example.com/billing/cancel",
  } as const;

  test("a disabled provider fails as feature-disabled before the consent is looked at", async () => {
    billingEnabled = false;
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      SUBSCRIPTION_BODY,
      adminFor(8110),
    );
    expect(JSON.stringify(error)).not.toContain("consent_required");
    expect(JSON.stringify(error)).toContain("feature_disabled");
    expect(checkoutCalls).toHaveLength(0);
  });

  test("an existing subscription fails as conflict before the consent is looked at", async () => {
    const admin = adminFor(8111);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentFor("de") },
      admin,
    );
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      {
        providerEventId: "evt_existing_8111",
        providerName: "mock-consent-provider",
        type: "subscription.created",
        providerCustomerId: "cus_existing",
        providerSubscriptionId: "sub_existing",
        status: SubscriptionStatuses.active,
        tier: "pro",
        currentPeriodEndIso: "2999-01-01T00:00:00Z",
      },
      admin,
    );
    checkoutCalls.length = 0;
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      SUBSCRIPTION_BODY,
      admin,
    );
    expect(error.httpStatus).toBe(409);
    expect(JSON.stringify(error)).not.toContain("consent_required");
  });

  test("an unknown priceId fails as unknown_price before the consent is looked at", async () => {
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      { ...SUBSCRIPTION_BODY, priceId: "price_nope" },
      adminFor(8112),
    );
    expect(JSON.stringify(error)).toContain("unknown_price");
    expect(JSON.stringify(error)).not.toContain("consent_required");
  });

  test("a price the provider cannot resolve fails as price_unavailable before the provider is called", async () => {
    const admin = adminFor(8113);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      {
        ...PAYMENT_BODY,
        priceId: "price_unlisted",
        consent: consentFor("en", consentTextVersion("en")),
      },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("price_unavailable");
    expect(checkoutCalls).toHaveLength(0);
    expect(await consentEvents(paymentAggregateId(admin.tenantId), admin.tenantId)).toEqual([]);
  });

  test("oneOffItemLabel is stored on the consent event; a client orderItem is rejected", async () => {
    const admin = adminFor(8114);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.createCheckoutSession,
      { ...PAYMENT_BODY, consent: consentFor("en", consentTextVersion("en")) },
      admin,
    );
    const events = await consentEvents(paymentAggregateId(admin.tenantId), admin.tenantId);
    expect(events[0]?.payload).toMatchObject({
      itemLabelKey: "shop:pack.credits",
      itemLabelParams: { count: 500, name: "Pack" },
    });

    const rejected = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      {
        ...PAYMENT_BODY,
        consent: consentFor("en", consentTextVersion("en")),
        orderItem: { labelKey: "x" },
      },
      admin,
    );
    expect(rejected.httpStatus).toBe(400);
  });
});

describe("consumerProtection on — billing-plans query", () => {
  test("exposes the consent texts with their versions and the legal links", async () => {
    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      adminFor(8108),
    )) as {
      consumerProtection: {
        consentTexts: Record<string, { consentTextVersion: string }>;
        legalLinks: unknown;
      };
    };
    expect(result.consumerProtection.consentTexts["de"]?.consentTextVersion).toBe(
      consentTextVersion("de"),
    );
    expect(result.consumerProtection.consentTexts["en"]?.consentTextVersion).toBe(
      consentTextVersion("en"),
    );
    expect(result.consumerProtection.legalLinks).toEqual({
      de: consumerProtection.legalLinks,
      en: consumerProtection.legalLinks,
    });
  });
});
