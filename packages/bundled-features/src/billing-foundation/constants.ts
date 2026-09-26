// @runtime client
// temporal-polyfill is a plain npm dependency (not a framework runtime
// module), so importing it here doesn't break browser bundles. Aliased —
// same reason as event-store.ts's own import: the un-aliased name would
// shadow the ambient global `Temporal` TYPE every `Temporal.Instant`
// annotation in this file (and its callers, e.g. StoredEvent.createdAt)
// resolves against, see #1438.
import { Temporal as TemporalPolyfill } from "temporal-polyfill";

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
  /** Tenant-Admin/purchase-role picks a plan tier from the catalog with no
   *  existing non-terminal subscription — starts a hosted checkout for the
   *  matching price. Only registered when `createBillingFoundationFeature`
   *  gets a `catalog`. */
  startPlanCheckout: "billing-foundation:write:start-plan-checkout",
  /** Tenant-Admin/purchase-role switches an existing non-terminal
   *  subscription to another plan tier via the provider's confirmation
   *  page. Only registered when a `catalog` is configured. */
  switchPlan: "billing-foundation:write:switch-plan",
} as const;

// Qualified query handler names.
export const SubscriptionFoundationQueries = {
  /** Sysadmin-cross-tenant + tenant-scoped self-list auf der
   *  read_subscriptions-projection. Tenant-Admin sieht via ctx.db
   *  tenant-scoping nur die eigene row. */
  listSubscriptions: "billing-foundation:query:subscription:list",
  /** Lists the catalog's plans with live price, benefits, the caller's
   *  current tier and per-plan action. Only registered when a `catalog` is
   *  configured. */
  billingPlans: "billing-foundation:query:billing-plans",
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

// Billing-plans screen/panel identifiers — the dormant dashboard app-builders
// mount their own catalog-derived nav entry onto.
export const BILLING_PLANS_SCREEN_ID = "billing-plans" as const;
export const BILLING_PLANS_PANEL_COMPONENT = "BillingPlansPanel" as const;

// Per-plan action a tenant-admin can take on the billing-plans query result.
export const BillingPlanActions = {
  checkout: "checkout",
  switch: "switch",
  current: "current",
  unavailable: "unavailable",
  /** A young `incomplete` subscription for this tier — checkout was started
   *  but Stripe hasn't confirmed payment yet. No CTA; the panel shows a
   *  "still completing" hint instead. */
  paymentPending: "paymentPending",
} as const;
export type BillingPlanAction = (typeof BillingPlanActions)[keyof typeof BillingPlanActions];

// A canceled subscription is terminal — the tenant has no more billing
// relationship with the provider and a plan pick starts a fresh checkout
// instead of a plan-switch. Every other status (including past_due) still
// has a live provider subscription-object to switch.
export const TERMINAL_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  SubscriptionStatuses.canceled,
]);
export function isTerminalSubscriptionStatus(status: string): boolean {
  return TERMINAL_SUBSCRIPTION_STATUSES.has(status);
}

// Stripe auto-expires an "incomplete" subscription (payment never completed)
// after roughly 23 hours; without a matching staleness cutoff on our side, a
// stale incomplete row would block that tenant from ever starting a new
// checkout, since the projection has no expiry-triggered event of its own.
export const STALE_INCOMPLETE_AFTER = TemporalPolyfill.Duration.from({ hours: 24 });

/** Time-aware terminal check for the checkout gate: a canceled subscription
 *  is terminal (see `isTerminalSubscriptionStatus`), and so is an
 *  `incomplete` one once it's older than `STALE_INCOMPLETE_AFTER` — every
 *  other status (including a fresh `incomplete`) still blocks a new
 *  checkout. */
export function isSubscriptionBlockingCheckout(
  sub: { readonly status: string; readonly lastChangedAt: Temporal.Instant },
  now: Temporal.Instant,
): boolean {
  if (isTerminalSubscriptionStatus(sub.status)) return false;
  if (sub.status !== SubscriptionStatuses.incomplete) return true;
  const staleAt = sub.lastChangedAt.add(STALE_INCOMPLETE_AFTER);
  // @cast-boundary temporal-polyfill-vs-ambient: same TC39 Temporal.Instant
  // at runtime — row types resolve against ambient Temporal; polyfill Instant
  // is a separate nominal type across the two .d.ts sources.
  return (
    TemporalPolyfill.Instant.compare(
      now as unknown as InstanceType<typeof TemporalPolyfill.Instant>,
      staleAt as unknown as InstanceType<typeof TemporalPolyfill.Instant>,
    ) < 0
  );
}

// A subscription in one of these statuses can be switched to a different
// plan tier via the provider's confirmation page (Stripe portal
// subscription_update_confirm and equivalents) — incomplete subscriptions
// never activated and are excluded.
export const SWITCHABLE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  SubscriptionStatuses.active,
  SubscriptionStatuses.trialing,
  SubscriptionStatuses.pastDue,
]);
export function isSwitchableSubscriptionStatus(status: string): boolean {
  return SWITCHABLE_SUBSCRIPTION_STATUSES.has(status);
}

// Default purchase-roles for a billing-plans catalog when the app doesn't
// override `purchaseRoles` — matches create-checkout-session's existing
// TenantAdmin/SystemAdmin-only access.
export const DEFAULT_PURCHASE_ROLES = ["TenantAdmin", "SystemAdmin"] as const;

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
