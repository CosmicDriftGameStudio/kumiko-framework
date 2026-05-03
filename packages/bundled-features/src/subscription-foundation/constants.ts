// Feature name
export const SUBSCRIPTION_FOUNDATION_FEATURE = "subscription-foundation" as const;

// Extension-point name fuer Provider-Plugins (subscription-stripe,
// subscription-mollie, ...).
export const SUBSCRIPTION_PROVIDER_EXTENSION = "subscriptionProvider" as const;

// Qualified write handler names (QN format: scope:type:name).
export const SubscriptionFoundationHandlers = {
  /** Programmatic entry-point für den webhook-handler. Receives the
   *  parsed SubscriptionEvent (vom Plugin schon verifiziert) + macht
   *  insert-event + upsert-subscription + tier-sync atomic. */
  processEvent: "subscription-foundation:write:process-event",
} as const;

// Qualified query handler names.
export const SubscriptionFoundationQueries = {
  /** Current subscription state für einen Tenant. SystemAdmin oder der
   *  Tenant-Admin selbst können das lesen. */
  current: "subscription-foundation:query:current",
} as const;

// Normalized subscription-event types — provider-agnostic.
// Alle Provider-Plugins normalisieren ihre eigenen event-types auf einen
// dieser. Whitelist: was die Foundation kennt; alles andere muss der
// Plugin filtern und null returnen aus verifyAndParseWebhook.
export const SubscriptionEventTypes = {
  created: "subscription.created",
  updated: "subscription.updated",
  canceled: "subscription.canceled",
  invoicePaid: "invoice.paid",
  invoicePaymentFailed: "invoice.payment-failed",
} as const;
export type SubscriptionEventType =
  (typeof SubscriptionEventTypes)[keyof typeof SubscriptionEventTypes];

// Normalized subscription-status values — provider-agnostic.
// Stripe + Mollie haben verschiedene Status-Sets; Plugin mapped auf
// diesen common-subset.
export const SubscriptionStatuses = {
  active: "active",
  trialing: "trialing",
  pastDue: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatuses)[keyof typeof SubscriptionStatuses];

// **Multi-Provider von Tag 1:** subscription-foundation hat KEIN
// `provider`-config-key. Alle gemounteten Plugins sind aktiv parallel —
// der Endkunde wählt beim Subscribe-Klick zwischen Karte/PayPal/
// Apple-Pay/Klarna/SEPA (Disney+-Pattern). Welcher Provider die
// aktuelle subscription des Tenants gerade hält steht in
// subscription.providerName, kommt aus dem checkout-flow.
//
// price-to-tier-Map ist KEIN foundation-config — pro-Plugin, weil
// Stripe-priceIds vs PayPal-plan-ids vs Apple-product-ids
// unterschiedliche IDs sind. Jeder Plugin definiert seinen eigenen
// `<plugin-name>:config:price-to-tier`-Key.
