// feature.ts contract tests for subscription-mollie.

import { describe, expect, test } from "bun:test";
import { MOLLIE_PROVIDER_NAME, SUBSCRIPTION_MOLLIE_FEATURE } from "../constants";
import { createSubscriptionMollieFeature } from "../feature";

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
    expect(typeof plugin?.verifyAndParseWebhook).toBe("function");
    expect(typeof plugin?.createCheckoutSession).toBe("function");
    expect(plugin?.createPortalSession).toBeUndefined();
    expect(plugin?.cancelSubscription).toBeUndefined();
  });
});
