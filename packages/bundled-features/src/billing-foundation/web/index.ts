// @runtime client
// Public exports for the browser side of the billing-foundation feature.
// Consumed via `@cosmicdrift/kumiko-bundled-features/billing-foundation/web` —
// the server side (createBillingFoundationFeature) lives under
// `@cosmicdrift/kumiko-bundled-features/billing-foundation` and has no React deps.

export {
  BILLING_PLANS_SCREEN_ID,
  type BillingPlanAction,
  BillingPlanActions,
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "../constants.js";
export {
  CONSENT_LOCALES,
  type ConsentLocale,
  resolveConsentLocale,
} from "../consumer-protection/consent-locale.js";
export type {
  BillingPlanBenefit,
  BillingPlanCatalog,
  BillingPlansResult,
  BillingPlanView,
  LegalLinkSet,
} from "../types.js";
export { BillingPlansPanel } from "./billing-plans-panel.js";
export {
  CheckoutConsentDialog,
  type CheckoutConsentDialogProps,
  type CheckoutConsentPayload,
  CONSENT_TEXT_OUTDATED_CODE,
} from "./checkout-consent-dialog.js";
export { type BillingFoundationClientOptions, billingFoundationClient } from "./client-plugin.js";
