// feature.ts contract tests for subscription-stripe.

import { describe, expect, test } from "bun:test";
import { STRIPE_PROVIDER_NAME, StripeEventTypes, SUBSCRIPTION_STRIPE_FEATURE } from "../constants";
import { createSubscriptionStripeFeature } from "../feature";

const OPTIONS = {
  priceToTier: { price_test: "pro" },
};

describe("createSubscriptionStripeFeature — shape", () => {
  test("has the expected name", () => {
    const feature = createSubscriptionStripeFeature(OPTIONS);
    expect(feature.name).toBe(SUBSCRIPTION_STRIPE_FEATURE);
    expect(feature.name).toBe("subscription-stripe");
  });

  test("requires billing-foundation + config + secrets (runtime-keys via config/secrets)", () => {
    const feature = createSubscriptionStripeFeature(OPTIONS);
    expect(feature.requires).toContain("billing-foundation");
    // Drift-Pin (v2): api-key/webhook-secret kommen ZUR LAUFZEIT aus
    // secrets, billing-live aus config — daher harte deps auf beide.
    expect(feature.requires).toContain("config");
    expect(feature.requires).toContain("secrets");
  });
});

describe("createSubscriptionStripeFeature — mounts without mount-time credentials", () => {
  test("mounts with no options at all (keys resolved at runtime from secrets)", () => {
    // v1 warf hier bei leerem webhookSecret/apiKey. v2 mountet immer —
    // die Credentials kommen erst zur Laufzeit aus config/secrets, der
    // billing-live-Gate hält den Checkout solange inert.
    expect(() => createSubscriptionStripeFeature()).not.toThrow();
  });

  test("mounts with only priceToTier (no api/webhook keys passed)", () => {
    expect(() =>
      createSubscriptionStripeFeature({ priceToTier: { price_x: "pro" } }),
    ).not.toThrow();
  });

  test("mounts with bridge-fallback keys passed (env→secrets transition)", () => {
    expect(() =>
      createSubscriptionStripeFeature({
        apiKey: "sk_test_dummy",
        webhookSecret: "whsec_dummy",
        priceToTier: { price_x: "pro" },
      }),
    ).not.toThrow();
  });
});

describe("subscription-stripe — plugin-registration", () => {
  test("registers itself under entityName 'stripe' for billing-foundation's extension", () => {
    const feature = createSubscriptionStripeFeature(OPTIONS);
    const usages = feature.extensionUsages;
    expect(
      usages.some(
        (u) => u.extensionName === "subscriptionProvider" && u.entityName === STRIPE_PROVIDER_NAME,
      ),
    ).toBe(true);
  });

  test("plugin-options have a valid SubscriptionProviderPlugin shape (drift-pin alle 4 methods)", () => {
    // Stärker als nur "extension-usage existiert": wenn jemand eine der
    // plugin-methods aus dem plugin-build entfernt, würde der
    // entsprechende Foundation-write-handler zur Laufzeit als
    // "method not supported"-error brechen — type-check würde es nicht
    // fangen weil die useExtension-options als `unknown` durchgereicht
    // werden.
    const feature = createSubscriptionStripeFeature(OPTIONS);
    const usage = feature.extensionUsages.find((u) => u.entityName === STRIPE_PROVIDER_NAME);
    expect(usage).toBeDefined();
    const options = usage?.options as {
      verifyAndParseWebhook?: unknown;
      createCheckoutSession?: unknown;
      createPortalSession?: unknown;
      cancelSubscription?: unknown;
    };
    expect(typeof options?.verifyAndParseWebhook).toBe("function");
    expect(typeof options?.createCheckoutSession).toBe("function");
    expect(typeof options?.createPortalSession).toBe("function");
    expect(typeof options?.cancelSubscription).toBe("function");
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
