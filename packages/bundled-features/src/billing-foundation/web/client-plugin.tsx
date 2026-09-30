// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { BILLING_FOUNDATION_FEATURE, BILLING_PLANS_PANEL_COMPONENT } from "../constants.js";
import { BillingPlansPanel } from "./billing-plans-panel.js";

export type BillingFoundationClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function billingFoundationClient(
  options?: BillingFoundationClientOptions,
): ClientFeatureDefinition {
  return {
    name: BILLING_FOUNDATION_FEATURE,
    extensionSectionComponents: {
      [BILLING_PLANS_PANEL_COMPONENT]: BillingPlansPanel,
    },
    ...(options?.translations !== undefined && { translations: options.translations }),
  };
}
