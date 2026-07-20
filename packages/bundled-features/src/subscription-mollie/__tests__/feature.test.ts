// feature.ts contract tests for subscription-mollie.

import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { MollieClient } from "@mollie/api-client";
import { describeSubscriptionProviderContract } from "../../billing-foundation/__tests__/subscription-provider-contract";
import { MOLLIE_PROVIDER_NAME, SUBSCRIPTION_MOLLIE_FEATURE } from "../constants";
import { createSubscriptionMollieFeature } from "../feature";
import { createMollieCheckoutSession } from "../plugin-methods";
import { type MollieClientShape, verifyAndParseMollieWebhook } from "../verify-webhook";

const VALID_OPTIONS = {
  apiKey: "test_dummy_apikey",
  webhookUrl: "https://app.example.com/api/subscription/webhook/mollie",
  priceToTier: { plan_pro: "pro" },
  priceToConfig: {
    plan_pro: {
      amountValue: "9.99",
      amountCurrency: "EUR",
      interval: "1 month",
      description: "Pro Plan",
    },
  },
};

describe("createSubscriptionMollieFeature — shape", () => {
  test("has the expected name", () => {
    const feature = createSubscriptionMollieFeature(VALID_OPTIONS);
    expect(feature.name).toBe(SUBSCRIPTION_MOLLIE_FEATURE);
    expect(feature.name).toBe("subscription-mollie");
  });

  test("requires only subscription-foundation (alles app-wide via factory-options)", () => {
    const feature = createSubscriptionMollieFeature(VALID_OPTIONS);
    expect(feature.requires).toContain("billing-foundation");
    expect(feature.requires).not.toContain("config");
    expect(feature.requires).not.toContain("secrets");
  });
});

describe("createSubscriptionMollieFeature — module-load validation", () => {
  test("throws bei empty apiKey", () => {
    expect(() => createSubscriptionMollieFeature({ ...VALID_OPTIONS, apiKey: "" })).toThrow(
      /apiKey is empty/,
    );
  });

  test("throws bei empty webhookUrl", () => {
    expect(() => createSubscriptionMollieFeature({ ...VALID_OPTIONS, webhookUrl: "" })).toThrow(
      /webhookUrl is empty/,
    );
  });

  test("throws bei priceToTier ↔ priceToConfig drift (priceId nur in tier)", () => {
    expect(() =>
      createSubscriptionMollieFeature({
        ...VALID_OPTIONS,
        priceToTier: { plan_pro: "pro", plan_business: "business" },
        // plan_business fehlt in config
      }),
    ).toThrow(/missing config:.*plan_business/);
  });

  test("throws bei priceToTier ↔ priceToConfig drift (priceId nur in config)", () => {
    expect(() =>
      createSubscriptionMollieFeature({
        ...VALID_OPTIONS,
        priceToConfig: {
          ...VALID_OPTIONS.priceToConfig,
          plan_extra: {
            amountValue: "29.99",
            amountCurrency: "EUR",
            interval: "1 month",
            description: "Extra",
          },
        },
        // plan_extra fehlt in tier
      }),
    ).toThrow(/missing tier:.*plan_extra/);
  });
});

describe("subscription-mollie — plugin-registration", () => {
  test("registers under entityName 'mollie' for subscription-foundation extension", () => {
    const feature = createSubscriptionMollieFeature(VALID_OPTIONS);
    expect(
      feature.extensionUsages.some(
        (u) => u.extensionName === "subscriptionProvider" && u.entityName === MOLLIE_PROVIDER_NAME,
      ),
    ).toBe(true);
  });

  test("plugin has verifyAndParseWebhook + createCheckoutSession; KEIN portal/cancel (Mollie-Limit)", () => {
    // Drift-Pin: Mollie's Plugin-shape ist intentional schmaler als Stripe.
    // Wenn jemand einen createPortalSession-stub hinzufügt der "not-supported"
    // wirft, würde das die foundation-error-Story ändern. Phase-5.3-MVP
    // lässt die optional-Fields KOMPLETT weg.
    const feature = createSubscriptionMollieFeature(VALID_OPTIONS);
    const usage = feature.extensionUsages.find((u) => u.entityName === MOLLIE_PROVIDER_NAME);
    const plugin = usage?.options as {
      verifyAndParseWebhook?: unknown;
      createCheckoutSession?: unknown;
      createPortalSession?: unknown;
      cancelSubscription?: unknown;
    };
    // Checks the mounted feature (the contract below builds its plugin
    // by hand-wiring and would not catch a wiring gap here).
    expect(typeof plugin?.verifyAndParseWebhook).toBe("function");
    expect(typeof plugin?.createCheckoutSession).toBe("function");
    expect(plugin?.createPortalSession).toBeUndefined();
    expect(plugin?.cancelSubscription).toBeUndefined();
  });
});

// =============================================================================
// SubscriptionProviderPlugin contract
// =============================================================================
//
// Built directly from the plugin-method constructors (not from
// createSubscriptionMollieFeature's mounted plugin) — same reasoning as
// subscription-stripe's contract fixture: keeps SDK-call mocking local to
// the fixture instead of routing through the full feature-mount.

const CONTRACT_TENANT_ID = "tenant-contract";
const CONTRACT_PRICE_ID = "plan_pro";

function buildMollieContractFixture() {
  const subscription = {
    id: "sub_contract_001",
    customerId: "cst_contract_001",
    status: "active",
    nextPaymentDate: "2026-06-15",
    startDate: "2026-05-15",
    metadata: { tenantId: CONTRACT_TENANT_ID, priceId: CONTRACT_PRICE_ID },
    // biome-ignore lint/suspicious/noExplicitAny: minimal Mollie-SDK-shape mock
  } as any;
  const payment = {
    id: "tr_contract_001",
    customerId: "cst_contract_001",
    subscriptionId: "sub_contract_001",
    sequenceType: "first",
    status: "paid",
    // biome-ignore lint/suspicious/noExplicitAny: minimal Mollie-SDK-shape mock
  } as any;

  const webhookClient: MollieClientShape = {
    payments: { get: async () => payment },
    customerSubscriptions: {
      get: async () => subscription,
      list: async () => [],
      create: async () => subscription,
    },
  };

  const checkoutClient = {
    customers: { create: async () => ({ id: "cus_contract" }) },
    payments: {
      create: async () => ({
        getCheckoutUrl: () => "https://www.mollie.com/checkout/contract-test",
      }),
    },
  } as unknown as MollieClient;

  return {
    plugin: {
      verifyAndParseWebhook: verifyAndParseMollieWebhook(webhookClient, {
        priceToTier: VALID_OPTIONS.priceToTier,
        priceToConfig: VALID_OPTIONS.priceToConfig,
      }),
      createCheckoutSession: createMollieCheckoutSession(
        checkoutClient,
        VALID_OPTIONS.priceToConfig,
        VALID_OPTIONS.webhookUrl,
      ),
      // createPortalSession + cancelSubscription deliberately omitted — Mollie limitation.
    },
    ctx: {} as HandlerContext,
    checkout: {
      priceId: CONTRACT_PRICE_ID,
      tenantId: CONTRACT_TENANT_ID,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
    webhook: {
      rawBody: JSON.stringify({ id: "tr_contract_001" }),
      headers: { "content-type": "application/json" },
      expectedTenantId: CONTRACT_TENANT_ID,
      expectedTier: "pro",
    },
  };
}

describeSubscriptionProviderContract("subscription-mollie", buildMollieContractFixture);
