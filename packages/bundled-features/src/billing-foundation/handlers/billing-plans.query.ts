// billing-plans — lists the catalog's purchasable plans with live price,
// benefits, the caller's current tier and per-plan action. Only registered
// when `createBillingFoundationFeature` gets a `catalog`.

import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { findCatalogProvider } from "../checkout-core.ts";
import {
  type CONSENT_LOCALES,
  CONSENT_TEXTS,
  consentTextVersion,
} from "../consumer-protection/consent-text.ts";
import { buildBillingPlans } from "../plan-catalog.ts";
import {
  type BillingPlanCatalog,
  type BillingPlansResult,
  type ConsumerProtectionOptions,
  isLegalLinkSet,
  type LegalLinkSet,
  type ResolvedBillingFoundationOptions,
} from "../types.ts";

const billingPlansSchema = z.object({}).strict();

export function createBillingPlansQuery(
  options: ResolvedBillingFoundationOptions,
  catalog: BillingPlanCatalog,
): QueryHandlerDef {
  return {
    name: "billing-plans",
    description:
      "Lists the purchasable plans with live price, benefits, the caller's current tier and which action (checkout | switch | current | unavailable | paymentPending) each plan offers, plus the optional price-less contact card.",
    schema: billingPlansSchema,
    access: { roles: catalog.viewRoles },
    handler: async (_query, ctx): Promise<BillingPlansResult> => {
      const found = findCatalogProvider(ctx, catalog);
      const result = await buildBillingPlans(ctx, found?.plugin ?? null, catalog, options.now);
      const { consumerProtection } = options;
      if (!consumerProtection) return result;
      return {
        ...result,
        consumerProtection: {
          consentTexts: {
            de: consentTextView("de"),
            en: consentTextView("en"),
          },
          legalLinks: legalLinksPerLocale(consumerProtection.legalLinks),
        },
      };
    },
  };
}

function legalLinksPerLocale(
  legalLinks: ConsumerProtectionOptions["legalLinks"],
): Readonly<Record<(typeof CONSENT_LOCALES)[number], LegalLinkSet>> {
  return isLegalLinkSet(legalLinks) ? { de: legalLinks, en: legalLinks } : legalLinks;
}

function consentTextView(locale: (typeof CONSENT_LOCALES)[number]) {
  const { earlyPerformance, withdrawalLoss } = CONSENT_TEXTS[locale];
  return { earlyPerformance, withdrawalLoss, consentTextVersion: consentTextVersion(locale) };
}
