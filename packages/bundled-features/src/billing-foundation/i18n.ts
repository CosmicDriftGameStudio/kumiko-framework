// English-only, per convention (see cap-overview/i18n.ts) — de/es coverage
// lives exclusively in the locale-de/locale-es packages' harvested
// strings.ts + en-catalog.ts, not inline here.
type LocalizedString = { readonly en: string };

export const BILLING_FOUNDATION_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:billing-plans.title": { en: "Billing" },
  "billing-foundation.plans.billingDisabled": {
    en: "Billing is not active yet. Your current plan stays in place.",
  },
  "billing-foundation.plans.currentPlan": { en: "Current plan" },
  "billing-foundation.plans.perInterval.day": { en: "/ day" },
  "billing-foundation.plans.perInterval.week": { en: "/ week" },
  "billing-foundation.plans.perInterval.month": { en: "/ month" },
  "billing-foundation.plans.perInterval.year": { en: "/ year" },
  "billing-foundation.plans.everyInterval.day": { en: "every {count} days" },
  "billing-foundation.plans.everyInterval.week": { en: "every {count} weeks" },
  "billing-foundation.plans.everyInterval.month": { en: "every {count} months" },
  "billing-foundation.plans.everyInterval.year": { en: "every {count} years" },
  "billing-foundation.plans.choose": { en: "Choose {plan}" },
  "billing-foundation.plans.switch": { en: "Switch to {plan}" },
  "billing-foundation.plans.manage": { en: "Manage subscription" },
  "billing-foundation.plans.paymentPending": {
    en: "Payment is still being completed.",
  },
  "billing-foundation.plans.priceUnavailable": { en: "Price not available" },
  "billing-foundation.plans.purchaseNotAllowed": {
    en: "Only administrators can change the plan.",
  },
  "billing-foundation.plans.subscriptionPending": {
    en: "Your plan change is being processed.",
  },
  "billing-foundation.errors.redirectOriginNotAllowed": {
    en: "This redirect URL is not allowed for this app.",
  },
  "billing-foundation.errors.providerHasNoPriceCatalog": {
    en: "This provider has no known prices configured.",
  },
  "billing-foundation.errors.unknownPrice": { en: "This price is not recognized." },
  "billing-foundation.errors.foreignProviderCustomer": {
    en: "This customer account does not belong to your tenant.",
  },
  "billing-foundation.errors.subscriptionExists": {
    en: "This tenant already has an active subscription. Switch plans instead.",
  },
  "billing-foundation.errors.noActiveSubscription": {
    en: "This tenant has no active subscription to switch.",
  },
  "billing-foundation.errors.alreadyOnPlan": { en: "This tenant is already on that plan." },
  "billing-foundation.errors.planSwitchNotSupported": {
    en: "This provider does not support switching plans.",
  },
  "billing-foundation.errors.planTiersShareProduct": {
    en: "Each plan needs its own Stripe product. Contact support.",
  },
  "billing-foundation.errors.providerMismatch": {
    en: "This tenant's subscription is on a different provider than the plan catalog. Contact support to migrate.",
  },
  "billing-foundation.errors.priceUnavailable": {
    en: "This plan's price is temporarily unavailable.",
  },
};
