// billing-plans — lists the catalog's purchasable plans with live price,
// benefits, the caller's current tier and per-plan action. Only registered
// when `createBillingFoundationFeature` gets a `catalog`.

import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { findCatalogProvider } from "../checkout-core.js";
import {
  type CONSENT_LOCALES,
  CONSENT_TEXTS,
  consentTextVersion,
} from "../consumer-protection/consent-text.js";
import { buildBillingPlans } from "../plan-catalog.js";
import type {
  BillingPlanCatalog,
  BillingPlansResult,
  ResolvedBillingFoundationOptions,
} from "../types.js";

const billingPlansSchema = z.object({}).strict();

export function createBillingPlansQuery(
  options: ResolvedBillingFoundationOptions,
  catalog: BillingPlanCatalog,
): QueryHandlerDef {
  return {
    name: "billing-plans",
    description:
      "Lists the purchasable plans with live price, benefits, the caller's current tier and which action (checkout | switch | current | unavailable | paymentPending) each plan offers.",
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
          legalLinks: consumerProtection.legalLinks,
        },
      };
    },
  };
}

function consentTextView(locale: (typeof CONSENT_LOCALES)[number]) {
  const { earlyPerformance, withdrawalLoss } = CONSENT_TEXTS[locale];
  return { earlyPerformance, withdrawalLoss, consentTextVersion: consentTextVersion(locale) };
}
