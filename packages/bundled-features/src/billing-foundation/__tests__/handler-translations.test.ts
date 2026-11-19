import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { localeFrBundle } from "@cosmicdrift/kumiko-locale-fr";
import { localeItBundle } from "@cosmicdrift/kumiko-locale-it";
import { findHandlerTranslationGaps } from "../../agent-tools/index.ts";
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

const feature = createBillingFoundationFeature({
  baseUrl: "https://app.example.com",
  catalog,
  consumerProtection,
});

describe("billing-foundation handler translations", () => {
  test("the agent lint reports no translation gap with plan catalog and consumer protection", () => {
    expect(findHandlerTranslationGaps([feature])).toEqual([]);
  });

  test.each([
    ["de", localeDeBundle],
    ["es", localeEsBundle],
    ["fr", localeFrBundle],
    ["it", localeItBundle],
  ] as const)("every handler title the feature ships has a %s translation", (_locale, bundle) => {
    const titleKeys = Object.keys(feature.translations ?? {}).filter(
      (key) => key.startsWith("billing-foundation:write:") && key.endsWith(":title"),
    );
    expect(titleKeys.length).toBeGreaterThan(0);
    const untranslated = titleKeys.filter((key) => (bundle[key] ?? "").trim() === "");
    expect(untranslated).toEqual([]);
  });
});
