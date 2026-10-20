/// <reference types="temporal-polyfill/global" preserve="true" />
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

// Feature name
export const BILLING_FOUNDATION_FEATURE = "billing-foundation" as const;

// Extension-point name for provider plugins (subscription-stripe,
// subscription-mollie, ...).
export const SUBSCRIPTION_PROVIDER_EXTENSION = "subscriptionProvider" as const;

/** delivery notification type of the § 312f contract confirmation mail. */
export const CONTRACT_CONFIRMATION_NOTIFICATION_TYPE =
  "billing-foundation:notify:contract-confirmation" as const;

/** delivery notification types of the § 312k termination receipt and the
 *  operator notice. */
export const CONTRACT_TERMINATION_RECEIPT_NOTIFICATION_TYPE =
  "billing-foundation:notify:contract-termination-receipt" as const;
export const CONTRACT_TERMINATION_OPERATOR_NOTIFICATION_TYPE =
  "billing-foundation:notify:contract-termination-operator-notice" as const;

// Qualified write handler names (QN format: scope:type:name).
export const SubscriptionFoundationHandlers = {
  /** Programmatic entry point for the webhook handler. Receives the
   *  parsed SubscriptionEvent (already verified by the plugin) and does
   *  insert-event + upsert-subscription + tier-sync atomically. */
  processEvent: "billing-foundation:write:process-event",
  /** Tenant admin clicks "Upgrade to Pro": the handler finds the chosen
   *  provider plugin, calls its createCheckoutSession and returns the
   *  hosted-page URL. The admin is redirected there; the subsequent
   *  provider webhook creates the subscription. */
  createCheckoutSession: "billing-foundation:write:create-checkout-session",
  /** Tenant admin clicks "Manage Subscription": the handler finds the
   *  current subscription, calls plugin.createPortalSession and returns the
   *  hosted-portal URL. */
  createPortalSession: "billing-foundation:write:create-portal-session",
  /** Programmatic entry-point for the webhook-handler on a one-off-payment
   *  (checkout mode "payment"). Its own per-tenant aggregate-stream
   *  (payment-aggregate), separate from the subscription-aggregate — a
   *  payment is not a subscription-state transition. */
  processPaymentEvent: "billing-foundation:write:process-payment-event",
  /** System-only: sends the § 312f contract confirmation mail for a recorded
   *  checkout consent (consumerProtection only). */
  issueContractConfirmation: "billing-foundation:write:issue-contract-confirmation",
  /** System-only: records a termination/withdrawal on the tenant's
   *  subscription stream and asks the provider to cancel (consumerProtection
   *  only). */
  recordContractTermination: "billing-foundation:write:record-contract-termination",
  /** System-only: records that a public declaration reached a tenant's
   *  subscription stream; the event triggers the provider cancel job
   *  (consumerProtection only). */
  declareContractTermination: "billing-foundation:write:declare-contract-termination",
  /** System-only: records a public declaration no single tenant could be
   *  matched to, on a system-tenant stream (consumerProtection only). */
  recordUnmatchedContractTermination:
    "billing-foundation:write:record-unmatched-contract-termination",
  /** Anonymous § 312k cancellation/withdrawal declaration (consumerProtection
   *  only). */
  requestContractTermination: "billing-foundation:write:request-contract-termination",
  /** Anonymous "this was not me" revocation of a public declaration, by the
   *  link of the receipt mail (consumerProtection only). */
  revokeContractTermination: "billing-foundation:write:revoke-contract-termination",
  /** System-only: checks the revocation token against the tenant's declaration
   *  and takes the cancellation back (consumerProtection only). */
  recordContractTerminationRevocation:
    "billing-foundation:write:record-contract-termination-revocation",
  /** Tenant-Admin terminates or withdraws from the contract of their own
   *  tenant (consumerProtection only). */
  terminateContract: "billing-foundation:write:terminate-contract",
  /** Tenant-Admin/purchase-role picks a plan tier from the catalog with no
   *  existing non-terminal subscription — starts a hosted checkout for the
   *  matching price. Only registered when `createBillingFoundationFeature`
   *  gets a `catalog`. */
  startPlanCheckout: "billing-foundation:write:start-plan-checkout",
  /** Tenant-Admin/purchase-role switches an existing non-terminal
   *  subscription to another plan tier via the provider's confirmation
   *  page. Only registered when a `catalog` is configured. */
  switchPlan: "billing-foundation:write:switch-plan",
  /** Backfill entry-point for the `sync-subscriptions` job (and any
   *  SystemAdmin that wants an on-demand reconciliation). Pulls the live
   *  provider-side state via the plugin's `retrieveSubscription` and
   *  appends drift as a `subscription.updated` event. `agent.expose: false`
   *  — programmatic only. */
  syncSubscription: "billing-foundation:write:sync-subscription",
} as const;

// Qualified query handler names.
export const SubscriptionFoundationQueries = {
  /** Sysadmin cross-tenant and tenant-scoped self-list on the
   *  read_subscriptions projection. A tenant admin only sees their own row
   *  because ctx.db is tenant-scoped. */
  listSubscriptions: "billing-foundation:query:subscription:list",
  /** Lists the catalog's plans with live price, benefits, the caller's
   *  current tier and per-plan action. Only registered when a `catalog` is
   *  configured. */
  billingPlans: "billing-foundation:query:billing-plans",
  /** System-only probe: does the caller tenant hold a non-terminal
   *  subscription (consumerProtection only). */
  terminableSubscription: "billing-foundation:query:terminable-subscription",
} as const;

// Normalized subscription-event types — provider-agnostic.
// All provider plugins normalize their own event types onto one of these.
// Whitelist of what the foundation knows; anything else must be filtered by
// the plugin, which returns null from verifyAndParseWebhook.
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
// Stripe and Mollie have different status sets; the plugin maps onto this
// common subset.
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

export const SubscriptionCancelTimings = {
  periodEnd: "period-end",
  immediately: "immediately",
} as const;
export type SubscriptionCancelTiming =
  (typeof SubscriptionCancelTimings)[keyof typeof SubscriptionCancelTimings];

// consentId is echoed back by the provider (checkout metadata), so it is
// untrusted input: bounded length, id-ish charset only.
const CONSENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function parseProviderConsentId(raw: unknown): string | undefined {
  return typeof raw === "string" && CONSENT_ID_PATTERN.test(raw) ? raw : undefined;
}

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
export const STALE_INCOMPLETE_AFTER = Temporal.Duration.from({ hours: 24 });

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
  return Temporal.Instant.compare(now, staleAt) < 0;
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

// **Multi-provider from day one:** subscription-foundation has NO `provider`
// config key. All mounted plugins are active in parallel; the end customer
// picks between card/PayPal/Apple Pay/Klarna/SEPA at subscribe time
// (Disney+ pattern). Which provider currently holds the tenant's
// subscription is stored in subscription.providerName, set by the checkout flow.
//
// The price-to-tier map is NOT foundation config: it is per plugin, because
// Stripe priceIds, PayPal plan ids and Apple product ids are different IDs.
// Each plugin defines its own `<plugin-name>:config:price-to-tier` key.

export const TERMINATION_SCOPES = ["tenant-host", "platform"] as const;
export type TerminationScope = (typeof TERMINATION_SCOPES)[number];

export function isTerminationScope(value: unknown): value is TerminationScope {
  return isOneOf(TERMINATION_SCOPES, value);
}

/** Advisory-lock namespace serialising appends onto one tenant's subscription stream. */
export const BILLING_SUBSCRIPTION_LOCK_NAMESPACE = 0x62_69_6c_6c; // 'bill'
