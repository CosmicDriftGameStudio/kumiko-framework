import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createSubscriptionMollieFeature } from "../feature.ts";

const validOptions = {
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

describe("subscription-mollie boot rules", () => {
  test("an empty apiKey violates empty-api-key", () => {
    const error = bootRuleViolationOf(() =>
      createSubscriptionMollieFeature({ ...validOptions, apiKey: "" }),
    );
    expect(error.rule.id).toBe("subscription-mollie/empty-api-key");
    expect(error.message).toContain("apiKey is empty");
  });

  test("an empty webhookUrl violates empty-webhook-url", () => {
    const error = bootRuleViolationOf(() =>
      createSubscriptionMollieFeature({ ...validOptions, webhookUrl: "" }),
    );
    expect(error.rule.id).toBe("subscription-mollie/empty-webhook-url");
    expect(error.message).toContain("webhookUrl is empty");
  });

  test("diverging price maps violate price-map-drift", () => {
    const error = bootRuleViolationOf(() =>
      createSubscriptionMollieFeature({ ...validOptions, priceToTier: { plan_other: "pro" } }),
    );
    expect(error.rule.id).toBe("subscription-mollie/price-map-drift");
    expect(error.message).toContain("priceToTier ↔ priceToConfig drift");
  });
});
