// feature.ts contract tests for subscription-stripe.

import { describe, expect, test } from "vitest";
import { STRIPE_PROVIDER_NAME, StripeEventTypes, SUBSCRIPTION_STRIPE_FEATURE } from "../constants";
import { createSubscriptionStripeFeature } from "../feature";

const VALID_OPTIONS = {
  webhookSecret: "whsec_test_dummy",
  apiKey: "sk_test_dummy",
  priceToTier: { price_test: "pro" },
};

describe("createSubscriptionStripeFeature — shape", () => {
  test("has the expected name", () => {
    const feature = createSubscriptionStripeFeature(VALID_OPTIONS);
    expect(feature.name).toBe(SUBSCRIPTION_STRIPE_FEATURE);
    expect(feature.name).toBe("subscription-stripe");
  });

  test("requires only subscription-foundation (NICHT config/secrets — alles app-wide via factory-options)", () => {
    const feature = createSubscriptionStripeFeature(VALID_OPTIONS);
    expect(feature.requires).toContain("subscription-foundation");
    // Drift-Pin: webhook-secret + apiKey kommen aus factory-options
    // (= module-load-Closure), NICHT aus tenant-config/-secrets.
    expect(feature.requires).not.toContain("config");
    expect(feature.requires).not.toContain("secrets");
  });
});

describe("createSubscriptionStripeFeature — module-load validation", () => {
  test("throws bei empty webhookSecret (= App-Owner hat sub-stripe gemountet aber Stripe-Account nicht konfiguriert)", () => {
    expect(() =>
      createSubscriptionStripeFeature({
        ...VALID_OPTIONS,
        webhookSecret: "",
      }),
    ).toThrow(/webhookSecret is empty/);
  });

  test("throws bei empty apiKey", () => {
    expect(() =>
      createSubscriptionStripeFeature({
        ...VALID_OPTIONS,
        apiKey: "",
      }),
    ).toThrow(/apiKey is empty/);
  });
});

describe("subscription-stripe — plugin-registration", () => {
  test("registers itself under entityName 'stripe' for subscription-foundation's extension", () => {
    const feature = createSubscriptionStripeFeature(VALID_OPTIONS);
    const usages = feature.extensionUsages;
    expect(
      usages.some(
        (u) => u.extensionName === "subscriptionProvider" && u.entityName === STRIPE_PROVIDER_NAME,
      ),
    ).toBe(true);
  });

  test("plugin-options have a valid SubscriptionProviderPlugin shape (drift-pin)", () => {
    // Stärker als nur "extension-usage existiert": wenn jemand
    // verifyAndParseWebhook aus dem plugin-build entfernt würde der
    // Multi-Provider-Webhook-Pfad zur Laufzeit als 401/Mystery-error
    // brechen — type-check würde es nicht fangen weil die useExtension-
    // options als `unknown` durchgereicht werden.
    const feature = createSubscriptionStripeFeature(VALID_OPTIONS);
    const usage = feature.extensionUsages.find((u) => u.entityName === STRIPE_PROVIDER_NAME);
    expect(usage).toBeDefined();
    const options = usage?.options as { verifyAndParseWebhook?: unknown };
    expect(typeof options?.verifyAndParseWebhook).toBe("function");
  });
});

describe("constants — Stripe-event-types die wir mappen", () => {
  test("StripeEventTypes whitelist — was die Foundation verarbeitet", () => {
    // Drift-Pin: ein Refactor das einen event-type rauswirft (z.B.
    // invoice.paid weil "wir nutzen das nicht") würde tier-grace-period-
    // tracking brechen. Plus: ein Refactor der einen NICHT-existing
    // Stripe-event-type reinschreibt (typo) würde silent ignored werden.
    expect(Object.values(StripeEventTypes)).toEqual([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
    ]);
  });
});
