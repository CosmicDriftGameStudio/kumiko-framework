// documentsAcknowledgement opt-in: real HTTP writes through setupTestStack,
// the recorded consent read back from the event store.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferenceEntity } from "../../delivery/tables.ts";
import { createTemplateResolverApi } from "../../template-resolver/api.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.ts";
import { SYSTEM_TENANT_ID, TEXT_BLOCK_KIND } from "../../template-resolver/web/constants.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import {
  consentTextVersion,
  documentsAcknowledgementTextFor,
} from "../consumer-protection/consent-text.ts";
import { CHECKOUT_CONSENT_RECORDED_EVENT_QN } from "../events.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionProviderPlugin,
} from "../types.ts";
import { SubscriptionFoundationHandlers, SubscriptionStatuses } from "../web/constants.ts";
import { openSubscriptionCheckout } from "./ledgered-subscription.ts";

const TERMS_SLUG = "billing-terms";

const baseOptions: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
  operatorEmail: "billing@example.com",
  legalLinks: {
    terms: "/legal/terms",
    withdrawal: "/legal/withdrawal",
    privacy: "/legal/privacy",
    refund: "/legal/refund",
  },
  documentsAcknowledgement: true,
};

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  tierLabelKey: (tier) => `plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async () => "free",
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  providerName: "mock-documents-provider",
};

let checkoutCount = 0;
let planSwitchCount = 0;

const mockProviderFeature = defineFeature("test-mock-documents-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    isBillingEnabled: async () => true,
    retrievePrices: async (_ctx, priceIds) =>
      ["price_starter", "price_pro"]
        .filter((priceId) => priceIds.includes(priceId))
        .map((priceId) => ({
          priceId,
          unitAmount: 900,
          currency: "eur",
          interval: "month" as const,
          intervalCount: 1,
          active: true,
          metadata: {},
        })),
    previewPlanSwitch: async () => ({
      amountDueNow: 667,
      tax: 106,
      currency: "eur",
      credit: 333,
      effectiveAt: "2030-06-01T00:00:00Z",
    }),
    applyPlanSwitch: async () => {
      planSwitchCount += 1;
    },
    createCheckoutSession: async (_ctx, options) => {
      checkoutCount += 1;
      return {
        url: `https://mock.example/checkout/${options.priceId}`,
        providerCheckoutId: `cs_${options.priceId}`,
      };
    },
  };
  r.useExtension("subscriptionProvider", "mock-documents-provider", plugin);
});

let stack: TestStack;
let plainStack: TestStack;

async function setup(consumerProtection: ConsumerProtectionOptions): Promise<TestStack> {
  const built = await setupTestStack({
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
      templateResolver: createTemplateResolverApi(deps.db, deps.registry),
    }),
  });
  await unsafeCreateEntityTable(built.db, tenantEntity);
  await unsafeCreateEntityTable(built.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(built.db, templateResourceEntity);
  await unsafeCreateEntityTable(built.db, notificationPreferenceEntity);
  return built;
}

beforeAll(async () => {
  stack = await setup(baseOptions);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  checkoutCount = 0;
  planSwitchCount = 0;
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`,
  );
  await resetTestTables(stack.db, [templateResourcesTable]);
  await seedTerms(stack);
});

async function seedTerms(target: TestStack): Promise<void> {
  await seedRowViaEventStore(target.db, templateResourcesTable, {
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
  });
}

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

const documentsVersion = consentTextVersion(
  "de",
  documentsAcknowledgementTextFor(baseOptions, "de"),
);

function consentWith(extra: { documentsAcknowledged?: boolean }) {
  return {
    earlyPerformanceRequested: true,
    withdrawalLossAcknowledged: true,
    consentTextVersion: documentsVersion,
    locale: "de",
    ...extra,
  };
}

async function consentEvents(tenantNumber: number) {
  const tenantId = testTenantId(tenantNumber);
  const events = await loadAggregate(stack.db, subscriptionAggregateId(tenantId), tenantId, {
    includeArchived: true,
  });
  return events.filter((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN);
}

describe("documentsAcknowledgement on — start-plan-checkout", () => {
  test("rejects a consent without the documents flag or with it unchecked, opens no checkout", async () => {
    const admin = adminFor(8201);
    const missing = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentWith({}) },
      admin,
    );
    const unchecked = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentWith({ documentsAcknowledged: false }) },
      admin,
    );
    for (const error of [missing, unchecked]) {
      expect(error.httpStatus).toBe(422);
      expect(JSON.stringify(error)).toContain("consent_required");
    }
    expect(checkoutCount).toBe(0);
    expect(await consentEvents(8201)).toEqual([]);
  });

  test("accepts the flag and records it on the consent event", async () => {
    const admin = adminFor(8202);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro", consent: consentWith({ documentsAcknowledged: true }) },
      admin,
    );
    expect(checkoutCount).toBe(1);
    const events = await consentEvents(8202);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      documentsAcknowledged: true,
      consentTextVersion: documentsVersion,
    });
  });

  test("the plain consent version is outdated once the option is on", async () => {
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      {
        tier: "pro",
        consent: {
          ...consentWith({ documentsAcknowledged: true }),
          consentTextVersion: consentTextVersion("de"),
        },
      },
      adminFor(8203),
    );
    expect(JSON.stringify(error)).toContain("consent_text_outdated");
    expect(checkoutCount).toBe(0);
  });

  test("billing-plans hands the text, version and refund link to the client", async () => {
    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      adminFor(8204),
    )) as {
      consumerProtection: {
        consentTexts: Record<
          string,
          { documentsAcknowledgement?: string; consentTextVersion: string }
        >;
        legalLinks: Record<string, { refund?: string }>;
      };
    };
    const de = result.consumerProtection.consentTexts["de"];
    expect(de?.documentsAcknowledgement).toContain("Erstattungsrichtlinie");
    expect(de?.consentTextVersion).toBe(documentsVersion);
    expect(result.consumerProtection.consentTexts["en"]?.documentsAcknowledgement).toContain(
      "Refund Policy",
    );
    expect(result.consumerProtection.legalLinks["de"]?.refund).toBe("/legal/refund");
  });
});

describe("documentsAcknowledgement on — create-checkout-session", () => {
  const checkoutBody = {
    providerName: "mock-documents-provider",
    priceId: "price_pro",
    successUrl: "https://app.example.com/billing/success",
    cancelUrl: "https://app.example.com/billing/cancel",
  } as const;

  test("rejects a consent without the documents flag and records the flag when given", async () => {
    const admin = adminFor(8207);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.createCheckoutSession,
      { ...checkoutBody, consent: consentWith({}) },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("consent_required");
    expect(checkoutCount).toBe(0);
    expect(await consentEvents(8207)).toEqual([]);

    await stack.http.writeOk(
      SubscriptionFoundationHandlers.createCheckoutSession,
      { ...checkoutBody, consent: consentWith({ documentsAcknowledged: true }) },
      admin,
    );
    expect(checkoutCount).toBe(1);
    const events = await consentEvents(8207);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ documentsAcknowledged: true });
  });
});

describe("documentsAcknowledgement on — switch-plan", () => {
  async function subscribe(tenantNumber: number): Promise<void> {
    const admin = adminFor(tenantNumber);
    const providerName = "mock-documents-provider";
    const providerSubscriptionId = `sub_${tenantNumber}`;
    const providerCheckoutId = await openSubscriptionCheckout(
      (handler, payload) => stack.http.writeOk(handler, payload, admin),
      { providerName, providerSubscriptionId, priceId: "price_starter" },
    );
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      {
        providerEventId: `evt_${tenantNumber}_create`,
        providerName,
        type: "subscription.created",
        providerCheckoutId,
        providerCustomerId: `cus_${tenantNumber}`,
        providerSubscriptionId,
        status: SubscriptionStatuses.active,
        tier: "starter",
        currentPeriodEndIso: "2030-06-01T00:00:00Z",
      },
      admin,
    );
  }

  test("rejects a consent without the documents flag and records the flag when given", async () => {
    await subscribe(8208);
    const admin = adminFor(8208);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro", consent: consentWith({}) },
      admin,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("consent_required");
    expect(planSwitchCount).toBe(0);

    const result = await stack.http.writeOk(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro", consent: consentWith({ documentsAcknowledged: true }) },
      admin,
    );
    expect(result).toEqual({ applied: true });
    expect(planSwitchCount).toBe(1);
    const events = await consentEvents(8208);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ documentsAcknowledged: true });
  });
});

describe("documentsAcknowledgement off", () => {
  beforeAll(async () => {
    const { documentsAcknowledgement: _off, ...withoutOption } = baseOptions;
    plainStack = await setup(withoutOption);
    await seedTerms(plainStack);
  });
  afterAll(async () => {
    await plainStack.cleanup();
  });

  test("the version and the client view stay as they were, and no documents flag is needed", async () => {
    const result = (await plainStack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      adminFor(8205),
    )) as {
      consumerProtection: {
        consentTexts: Record<
          string,
          { documentsAcknowledgement?: string; consentTextVersion: string }
        >;
      };
    };
    const de = result.consumerProtection.consentTexts["de"];
    expect(de?.documentsAcknowledgement).toBeUndefined();
    expect(de?.consentTextVersion).toBe(consentTextVersion("de"));

    await plainStack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      {
        tier: "pro",
        consent: { ...consentWith({}), consentTextVersion: consentTextVersion("de") },
      },
      adminFor(8205),
    );
    expect(checkoutCount).toBe(1);
  });
});

describe("providerTexts refundLink", () => {
  const { refund: _global, ...withoutGlobalRefund } = baseOptions.legalLinks as {
    terms: string;
    withdrawal: string;
    privacy: string;
    refund?: string;
  };
  const noGlobalRefund: ConsumerProtectionOptions = {
    ...baseOptions,
    legalLinks: withoutGlobalRefund,
  };
  const ownRefundOptions: ConsumerProtectionOptions = {
    ...noGlobalRefund,
    providerTexts: { "mock-documents-provider": { refundLink: "/legal/provider-refund" } },
  };
  const otherProviderOptions: ConsumerProtectionOptions = {
    ...noGlobalRefund,
    providerTexts: { "another-provider": { refundLink: "/legal/other-refund" } },
  };
  let ownStack: TestStack;
  let otherStack: TestStack;

  type PlansResult = {
    providers?: readonly {
      name: string;
      consumerProtection?: {
        consentTexts: Record<
          string,
          { documentsAcknowledgement?: string; consentTextVersion: string }
        >;
        legalLinks: Record<string, { refund?: string }>;
      };
    }[];
    consumerProtection: {
      consentTexts: Record<string, { consentTextVersion: string }>;
      legalLinks: Record<string, { refund?: string }>;
    };
  };

  beforeAll(async () => {
    ownStack = await setup(ownRefundOptions);
    await seedTerms(ownStack);
    otherStack = await setup(otherProviderOptions);
    await seedTerms(otherStack);
  });
  afterAll(async () => {
    await ownStack.cleanup();
    await otherStack.cleanup();
  });

  test("a provider with its own refundLink shows it and records the refund variant of the text", async () => {
    const plans = (await ownStack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      adminFor(8206),
    )) as PlansResult;
    const view = plans.providers?.find((p) => p.name === "mock-documents-provider");
    const providerVersion = consentTextVersion(
      "de",
      documentsAcknowledgementTextFor(ownRefundOptions, "de", "mock-documents-provider"),
    );
    expect(view?.consumerProtection?.legalLinks["de"]?.refund).toBe("/legal/provider-refund");
    expect(view?.consumerProtection?.consentTexts["de"]?.documentsAcknowledgement).toContain(
      "Erstattungsrichtlinie",
    );
    expect(view?.consumerProtection?.consentTexts["de"]?.consentTextVersion).toBe(providerVersion);
    expect(plans.consumerProtection.legalLinks["de"]?.refund).toBeUndefined();

    const withoutRefundVersion = consentTextVersion(
      "de",
      documentsAcknowledgementTextFor(noGlobalRefund, "de"),
    );
    const outdated = await ownStack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      {
        tier: "pro",
        providerName: "mock-documents-provider",
        consent: {
          ...consentWith({ documentsAcknowledged: true }),
          consentTextVersion: withoutRefundVersion,
        },
      },
      adminFor(8206),
    );
    expect(JSON.stringify(outdated)).toContain("consent_text_outdated");

    await ownStack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      {
        tier: "pro",
        providerName: "mock-documents-provider",
        consent: {
          ...consentWith({ documentsAcknowledged: true }),
          consentTextVersion: providerVersion,
        },
      },
      adminFor(8206),
    );
    const tenantId = testTenantId(8206);
    const recorded = (
      await loadAggregate(ownStack.db, subscriptionAggregateId(tenantId), tenantId, {
        includeArchived: true,
      })
    ).filter((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN);
    expect(recorded[0]?.payload).toMatchObject({
      providerName: "mock-documents-provider",
      documentsAcknowledged: true,
      consentTextVersion: providerVersion,
    });
  });

  test("a provider without refundLink and without legalLinks.refund shows none", async () => {
    const plans = (await otherStack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      adminFor(8207),
    )) as PlansResult;
    expect(plans.providers).toBeUndefined();
    expect(plans.consumerProtection.legalLinks["de"]?.refund).toBeUndefined();
    expect(plans.consumerProtection.legalLinks["en"]?.refund).toBeUndefined();

    const withoutRefundVersion = consentTextVersion(
      "de",
      documentsAcknowledgementTextFor(noGlobalRefund, "de"),
    );
    expect(plans.consumerProtection.consentTexts["de"]?.consentTextVersion).toBe(
      withoutRefundVersion,
    );
  });
});
