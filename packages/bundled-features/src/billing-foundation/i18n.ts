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
  "billing-foundation.plans.reactivate": { en: "Reactivate subscription" },
  "billing-foundation.plans.cancelScheduled": {
    en: "Your subscription is scheduled to end on {date}.",
  },
  "billing-foundation.plans.switchRequiresReactivation": {
    en: "Reactivate your subscription before switching plans.",
  },
  "billing-foundation.plans.paymentPending": {
    en: "Payment is still being completed.",
  },
  "billing-foundation.plans.pastDue": {
    en: "Your last payment failed. Update your payment method to avoid interruption.",
  },
  "billing-foundation.plans.priceUnavailable": { en: "Price not available" },
  "billing-foundation.plans.purchaseNotAllowed": {
    en: "Only administrators can change the plan.",
  },
  "billing-foundation.plans.subscriptionPending": {
    en: "Your plan change is being processed.",
  },
  "billing-foundation.consent.title": { en: "Review your order" },
  "billing-foundation.consent.cancelAnytime": {
    en: "You can cancel at any time, effective at the end of the current period.",
  },
  "billing-foundation.consent.renews.day": { en: "Renews every day until cancelled." },
  "billing-foundation.consent.renews.week": { en: "Renews every week until cancelled." },
  "billing-foundation.consent.renews.month": { en: "Renews every month until cancelled." },
  "billing-foundation.consent.renews.year": { en: "Renews every year until cancelled." },
  "billing-foundation.consent.renewsEvery.day": {
    en: "Renews every {count} days until cancelled.",
  },
  "billing-foundation.consent.renewsEvery.week": {
    en: "Renews every {count} weeks until cancelled.",
  },
  "billing-foundation.consent.renewsEvery.month": {
    en: "Renews every {count} months until cancelled.",
  },
  "billing-foundation.consent.renewsEvery.year": {
    en: "Renews every {count} years until cancelled.",
  },
  "billing-foundation.consent.link.terms": { en: "Terms" },
  "billing-foundation.consent.link.withdrawal": { en: "Withdrawal policy" },
  "billing-foundation.consent.link.privacy": { en: "Privacy policy" },
  "billing-foundation.consent.order": { en: "Order with obligation to pay" },
  "billing-foundation.consent.back": { en: "Back" },
  "billing-foundation.cancel.open": { en: "Cancel contract here" },
  "billing-foundation.cancel.title": { en: "Cancel contract" },
  "billing-foundation.cancel.declaration": { en: "Declaration" },
  "billing-foundation.cancel.declaration.termination": { en: "Termination" },
  "billing-foundation.cancel.declaration.withdrawal": { en: "Withdrawal" },
  "billing-foundation.cancel.withdrawalHint": {
    en: "A withdrawal is only possible within the statutory withdrawal period.",
  },
  "billing-foundation.cancel.kind": { en: "Type of termination" },
  "billing-foundation.cancel.kind.ordinary": { en: "Ordinary" },
  "billing-foundation.cancel.kind.extraordinary": { en: "Extraordinary (for cause)" },
  "billing-foundation.cancel.reason": { en: "Reason" },
  "billing-foundation.cancel.continue": { en: "Continue" },
  "billing-foundation.cancel.back": { en: "Back" },
  "billing-foundation.cancel.close": { en: "Close" },
  "billing-foundation.cancel.confirmQuestion": {
    en: "Do you want to submit this declaration now? Declaration: {declaration}, type: {kind}.",
  },
  "billing-foundation.cancel.submit": { en: "Cancel now" },
  "billing-foundation.cancel.receivedAt": { en: "We received your declaration on {date}." },
  "billing-foundation.cancel.effectiveAt": { en: "It takes effect on {date}." },
  "billing-foundation.cancel.effectiveUnknown": {
    en: "We will confirm the effective date by email.",
  },
  "billing-foundation.cancel.emailConfirmation": {
    en: "You will receive a confirmation by email.",
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
  "billing-foundation.errors.cancellationScheduled": {
    en: "This subscription is scheduled to end. Reactivate it before switching plans.",
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
  "billing-foundation.errors.consentRequired": {
    en: "Confirm both consent boxes before you continue.",
  },
  "billing-foundation.errors.consentTextOutdated": {
    en: "The consent text has changed. Reload the page and confirm again.",
  },
  "billing-foundation.errors.termsUnavailable": {
    en: "The terms are temporarily unavailable. Please try again later.",
  },
};
