// Feature name
export const BILLING_FOUNDATION_FEATURE = "billing-foundation" as const;

// Extension-point name fuer Provider-Plugins (subscription-stripe,
// subscription-mollie, ...).
export const SUBSCRIPTION_PROVIDER_EXTENSION = "subscriptionProvider" as const;

// Qualified write handler names (QN format: scope:type:name).
export const SubscriptionFoundationHandlers = {
  /** Programmatic entry-point für den webhook-handler. Receives the
   *  parsed SubscriptionEvent (vom Plugin schon verifiziert) + macht
   *  insert-event + upsert-subscription + tier-sync atomic. */
  processEvent: "billing-foundation:write:process-event",
  /** Tenant-Admin klickt "Upgrade to Pro" → handler findet den
   *  gewählten provider-plugin + ruft seine createCheckoutSession-
   *  Methode + returnt die hosted-page-URL. Tenant-Admin wird dorthin
   *  redirected, der subsequent provider-webhook erstellt die
   *  subscription. */
  createCheckoutSession: "billing-foundation:write:create-checkout-session",
  /** Tenant-Admin klickt "Manage Subscription" → handler findet
   *  current subscription, ruft plugin.createPortalSession, returnt
   *  hosted-portal-URL. */
  createPortalSession: "billing-foundation:write:create-portal-session",
  /** Programmatic entry-point for the webhook-handler on a one-off-payment
   *  (checkout mode "payment"). Its own per-tenant aggregate-stream
   *  (payment-aggregate), separate from the subscription-aggregate — a
   *  payment is not a subscription-state transition. */
  processPaymentEvent: "billing-foundation:write:process-payment-event",
} as const;

// Qualified query handler names.
export const SubscriptionFoundationQueries = {
  /** Sysadmin-cross-tenant + tenant-scoped self-list auf der
   *  read_subscriptions-projection. Tenant-Admin sieht via ctx.db
   *  tenant-scoping nur die eigene row. */
  listSubscriptions: "billing-foundation:query:subscription:list",
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

// Discriminator for verifyAndParseWebhook's return union. `subscription` is
// optional on SubscriptionEvent (kept backward-compatible for plugins like
// subscription-mollie that pre-date this field) and required on
// PaymentEvent — TS narrows `parsed.kind === BillingEventKinds.payment`
// correctly either way since only PaymentEvent's `kind` can equal it.
export const BillingEventKinds = {
  subscription: "subscription",
  payment: "payment",
} as const;
export type BillingEventKind = (typeof BillingEventKinds)[keyof typeof BillingEventKinds];

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
