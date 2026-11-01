import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type { BillingPlanCatalog, ConsumerProtectionOptions } from "../types.ts";

const catalog: BillingPlanCatalog = {
  plans: ["basic"],
  tierLabelKey: (tier) => `plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async () => "basic",
  viewRoles: ["TenantAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
};

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: "billing-terms",
  vatNote: { de: "inkl. USt.", en: "incl. VAT" },
  operatorEmail: "billing@example.com",
  legalLinks: { terms: "/terms", withdrawal: "/withdrawal", privacy: "https://example.com/p" },
};

const baseUrl = "https://app.example.com";

describe("billing-foundation boot rules", () => {
  test("an empty termsTextBlock violates consumer-protection-invalid", () => {
    const error = bootRuleViolationOf(() =>
      createBillingFoundationFeature({
        baseUrl,
        consumerProtection: { ...consumerProtection, termsTextBlock: " " },
      }),
    );
    expect(error.rule.id).toBe("billing-foundation/consumer-protection-invalid");
    expect(error.message).toContain("consumerProtection.termsTextBlock is empty");
  });

  test("an unparseable baseUrl violates base-url-invalid", () => {
    const error = bootRuleViolationOf(() => createBillingFoundationFeature({ baseUrl: "nope" }));
    expect(error.rule.id).toBe("billing-foundation/base-url-invalid");
    expect(error.message).toContain("is not a parseable absolute URL");
  });

  test("a catalog without baseUrl violates base-url-required", () => {
    const error = bootRuleViolationOf(() => createBillingFoundationFeature({ catalog }));
    expect(error.rule.id).toBe("billing-foundation/base-url-required");
    expect(error.message).toContain("catalog requires baseUrl");
  });

  test("a catalog without plans violates catalog-invalid", () => {
    const error = bootRuleViolationOf(() =>
      createBillingFoundationFeature({ baseUrl, catalog: { ...catalog, plans: [] } }),
    );
    expect(error.rule.id).toBe("billing-foundation/catalog-invalid");
    expect(error.message).toContain("catalog.plans must not be empty");
  });
});
