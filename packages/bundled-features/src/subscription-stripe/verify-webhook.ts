// verifyAndParseStripeWebhook — Stripe-specific signature verification +
// event mapping. Registered by the plugin build (feature.ts) as
// `verifyAndParseWebhook`.
//
// **Steps:**
//   1. Verify the signature via stripe.webhooks.constructEvent (HMAC-SHA-256
//      against rawBody + Stripe-Signature header). Throws on mismatch or
//      timestamps older than 5 minutes (replay protection).
//   1b. checkout.session.completed / .async_payment_succeeded branch off
//       here into a PaymentEvent (one-off-payment, own aggregate) — see
//       the "One-off-payment" section below. Everything else falls through.
//   2. Event-type filter: only the 5 event types mapped to
//      SubscriptionEventTypes continue; everything else returns null
//      (the foundation responds with 200 ignored).
//   3. Normalize the Stripe payload into a SubscriptionEvent
//      (status mapping, tenant ID from metadata, price-to-tier lookup).
//
// **Runtime keys (pre-tenant):** the API key and webhook secret no longer
// come from a mount-time closure; they are resolved from `StripeWebhookRuntime`
// at webhook time. The foundation webhook handler passes a system-scoped
// SecretsContext as the third argument; the runtime reads both keys from it
// (unaudited, system-internal), falling back to the factory options. This
// allows key rotation without a redeploy, and the invoice lazy-fetch below
// uses the same rotated client as signature verification, avoiding split-brain.
//
// **Invoice-event lazy-fetch:**
// Invoice payloads carry only the subscription ID (Stripe does not expand
// subscriptions in webhooks), so the plugin lazy-fetches via
// `stripe.subscriptions.retrieve(subId)` to get the full subscription for
// status/tier/period-end mapping. resource_missing (deleted between webhook
// and retrieval) returns null; any other Stripe error becomes 503 so Stripe
// redelivers.

import type {
  PaymentEvent,
  SubscriptionEvent,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  BillingEventKinds,
  parseProviderConsentId,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { ExtraRouteRejection } from "@cosmicdrift/kumiko-framework/api";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import Stripe from "stripe";
import { STRIPE_PROVIDER_NAME, StripeEventTypes } from "./constants.ts";
import type { StripeWebhookRuntime } from "./runtime.ts";

const log = createFallbackLogger("subscription-stripe");

export function isResourceMissingStripeError(
  error: unknown,
): error is Stripe.errors.StripeInvalidRequestError {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing"
  );
}

// Anything but resource_missing (network, 5xx, rate limit) is transient: a 503 makes Stripe retry,
// whereas a silent null would be acknowledged as 200 and the event lost for good.
function transientProviderRejection(error: unknown): ExtraRouteRejection {
  return new ExtraRouteRejection(
    503,
    { error: { code: "subscription_provider_transient" } },
    `stripe retrieve failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

// =============================================================================
// Sig-verify + parse
// =============================================================================

export type StripeWebhookOptions = {
  /** Price-to-tier map. The plugin reads the price ID from the event and
   *  maps it to a tier name. Returns null when the price ID is not mapped.
   *  App-specific and remains a factory option, not a secret. */
  readonly priceToTier: Readonly<Record<string, string>>;
};

/**
 * Stripe webhook handler implementing the plugin contract
 * `verifyAndParseWebhook`. **Pre-tenant resolution** — there is no
 * HandlerContext; instead of using a mount-time client, `runtime` resolves
 * the Stripe client and webhook secret at call time from the optional
 * system SecretsContext (third argument).
 */
export function verifyAndParseStripeWebhook(
  runtime: StripeWebhookRuntime,
  options: StripeWebhookOptions,
): (
  rawBody: string,
  headers: Record<string, string>,
  systemSecrets?: SecretsContext,
) => Promise<SubscriptionEvent | PaymentEvent | null> {
  return async (rawBody, headers, systemSecrets) => {
    const sigHeader = headers["stripe-signature"];
    if (!sigHeader) {
      throw new Error("subscription-stripe: stripe-signature header missing");
    }

    // 0. Resolve at runtime: obtain the API key (for the client and lazy fetch)
    //    and webhook secret (for signature verification) from system secrets,
    //    falling back to the factory options. Throws if neither is configured.
    const { stripe, webhookSecret } = await runtime.resolve(systemSecrets);

    // 1. Verify the signature. constructEvent throws on a mismatch (invalid
    //    signature) or timestamp-tolerance violation (default: 5 minutes).
    //    The foundation maps the thrown error to HTTP 401. This applies to
    //    BOTH branches below: the payment branch is selected only AFTER this
    //    check, so no path bypasses signature verification.
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sigHeader, webhookSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`subscription-stripe: webhook signature verify failed — ${msg}`);
    }

    // 1b. One-off-payment events (checkout mode "payment") branch off BEFORE
    //     the mapStripeEventType filter below — they don't map to a
    //     SubscriptionEventType and must not touch mapStripeEventType's
    //     5-item whitelist (drift-pin in verify-webhook.test.ts still
    //     expects null for "checkout.session.completed").
    if (isCheckoutSessionEventType(event.type)) {
      return await parsePaymentEvent(event, stripe);
    }

    // 2. Event-type filter — only 5 event types are supported.
    const normalizedType = mapStripeEventType(event.type);
    if (!normalizedType) {
      return null; // foundation returnt 200 ignored
    }

    // 3. Extract the payload. Stripe uses different data.object shapes
    //    depending on event.type. Extract subscription data either directly
    //    (subscription events) or through a lazy fetch (invoice events).
    const sub = await extractSubscriptionFromEvent(event, stripe);
    if (!sub) {
      // The event type passed the 5-item filter, but its payload shape did not
      // match — treat this as Stripe SDK schema drift and return null defensively.
      return null;
    }

    // 4. Resolve the tenant from metadata. The app builder sets
    //    `metadata.tenantId` when calling createCheckoutSession.
    const tenantId = sub.metadata?.["tenantId"];
    if (!tenantId || tenantId.length === 0) {
      // A subscription without tenant metadata cannot be created without tenant
      // resolution. Drop the event silently (the foundation responds with 200
      // ignored). This is an app-owner error, not a foundation error.
      return null;
    }

    // 5+6. Price-to-tier-Mapping + status/period-end/cancel_at — shared with
    //      plugin-methods.ts's createStripeRetrieveSubscription so both the
    //      webhook and the sync-subscriptions backfill map Stripe state
    //      identically.
    const state = mapStripeSubscriptionState(sub, options.priceToTier);
    if (!state) {
      return null;
    }

    const consentId = parseProviderConsentId(sub.metadata?.["consentId"]);
    return {
      providerEventId: event.id,
      providerName: STRIPE_PROVIDER_NAME,
      type: normalizedType,
      tenantId,
      ...(consentId !== undefined && { consentId }),
      providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      providerSubscriptionId: sub.id,
      providerEventAt: Temporal.Instant.fromEpochMilliseconds(event.created * 1000).toString(),
      ...state,
    };
  };
}

// =============================================================================
// Shared subscription-state mapping (webhook + retrieveSubscription)
// =============================================================================

export type MappedStripeSubscriptionState = {
  readonly status: SubscriptionStatus;
  readonly tier: string;
  readonly currentPeriodEnd: string;
  readonly cancelAt: string | null;
};

/** Maps a Stripe subscription's price/status/period-end/cancel_at onto the
 *  foundation's normalized shape. Null when the subscription's price isn't
 *  in `priceToTier` (the app owner created the Stripe price but never
 *  mapped it to a tier) or the item has no price id at all. */
export function mapStripeSubscriptionState(
  sub: Pick<Stripe.Subscription, "status" | "items" | "cancel_at" | "cancel_at_period_end">,
  priceToTier: Readonly<Record<string, string>>,
): MappedStripeSubscriptionState | null {
  const priceId = sub.items.data[0]?.price.id;
  if (!priceId) {
    return null;
  }
  const tier = priceToTier[priceId];
  if (!tier) {
    return null;
  }

  // Since 2024 Stripe reports period-end per item
  // (subscription.items.data[i].current_period_end), not per subscription.
  // We read the first item; multi-item subscriptions (add-ons) aren't
  // supported.
  const status = mapStripeStatus(sub.status);
  const periodEndUnixSec = sub.items.data[0]?.current_period_end ?? 0;
  // Stripe returns Unix-seconds; Temporal.Instant.fromEpochMilliseconds
  // expects ms. Multiply, then ISO. (No-Date-API-Guard forbids
  // `new Date()` — static import above, not the ambient global.)
  const currentPeriodEnd = Temporal.Instant.fromEpochMilliseconds(
    periodEndUnixSec * 1000,
  ).toString();
  const cancelAt = stripeCancelAtIso(sub, currentPeriodEnd);

  return { status, tier, currentPeriodEnd, cancelAt };
}

// =============================================================================
// Helpers
// =============================================================================

/** cancel_at is set once a cancellation is scheduled (an explicit future
 *  cancel_at, or cancel_at_period_end which Stripe resolves to the period
 *  end) — null means the subscription renews. cancel_at_period_end without
 *  cancel_at falls back to currentPeriodEnd, the value Stripe would report
 *  as cancel_at. */
export function stripeCancelAtIso(
  sub: Pick<Stripe.Subscription, "cancel_at" | "cancel_at_period_end">,
  currentPeriodEndIso: string,
): string | null {
  if (sub.cancel_at) {
    return Temporal.Instant.fromEpochMilliseconds(sub.cancel_at * 1000).toString();
  }
  return sub.cancel_at_period_end ? currentPeriodEndIso : null;
}

/** Stripe-event-type → normalisiert. null = ignore. */
export function mapStripeEventType(stripeType: string): SubscriptionEventType | null {
  switch (stripeType) {
    case StripeEventTypes.customerSubscriptionCreated:
      return SubscriptionEventTypes.created;
    case StripeEventTypes.customerSubscriptionUpdated:
      return SubscriptionEventTypes.updated;
    case StripeEventTypes.customerSubscriptionDeleted:
      return SubscriptionEventTypes.canceled;
    case StripeEventTypes.invoicePaid:
      return SubscriptionEventTypes.invoicePaid;
    case StripeEventTypes.invoicePaymentFailed:
      return SubscriptionEventTypes.invoicePaymentFailed;
    default:
      return null;
  }
}

/** Maps Stripe statuses to normalized statuses. Unknown statuses are
 *  mapped defensively to incomplete; the plugin should not receive them, but
 *  an invalid status string must not be stored in the database. */
export function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
      return SubscriptionStatuses.active;
    case "trialing":
      return SubscriptionStatuses.trialing;
    case "past_due":
    case "unpaid":
    case "paused":
      return SubscriptionStatuses.pastDue;
    case "canceled":
      return SubscriptionStatuses.canceled;
    // incomplete_expired: the subscription's first payment never completed
    // in time and Stripe abandoned it for good — unlike a live "incomplete"
    // (payment still retryable), this is terminal. Mapping it to canceled
    // (not incomplete) lets a tenant start a fresh checkout instead of
    // openCheckout's "subscription already exists" conflict blocking them.
    case "incomplete_expired":
      return SubscriptionStatuses.canceled;
    case "incomplete":
      return SubscriptionStatuses.incomplete;
    default:
      return SubscriptionStatuses.incomplete;
  }
}

/** Gets the subscription from the event. Subscription events include it
 *  directly in data.object; invoice events include only the subscription ID
 *  and require a lazy fetch via stripe.subscriptions.retrieve. */
// @wrapper-known semantic-alias
async function extractSubscriptionFromEvent(
  event: Stripe.Event,
  stripe: Stripe,
): Promise<Stripe.Subscription | null> {
  switch (event.type) {
    case StripeEventTypes.customerSubscriptionCreated:
    case StripeEventTypes.customerSubscriptionUpdated:
    case StripeEventTypes.customerSubscriptionDeleted:
      return event.data.object as Stripe.Subscription; // @cast-boundary engine-bridge
    case StripeEventTypes.invoicePaid:
    case StripeEventTypes.invoicePaymentFailed: {
      // Lazy-fetch the subscription. invoice.subscription is a string ID because
      // Stripe webhooks do not expand it automatically. Fetch the full
      // subscription so downstream status, tier via priceId, and period-end
      // mapping remain consistent.
      const invoice = event.data.object as Stripe.Invoice; // @cast-boundary engine-bridge
      const subRef = (invoice as { subscription?: string | Stripe.Subscription | null }) // @cast-boundary engine-payload
        .subscription;
      if (!subRef) {
        // An invoice without a subscription reference is a one-shot invoice, not a
        // recurring invoice. It is outside this domain and should be ignored.
        return null;
      }
      const subId = typeof subRef === "string" ? subRef : subRef.id;
      try {
        return await stripe.subscriptions.retrieve(subId);
      } catch (error) {
        // Subscription deleted between webhook and retrieve: null makes the
        // foundation answer 200 ignored; the next subscription event carries
        // the state.
        if (isResourceMissingStripeError(error)) return null;
        throw transientProviderRejection(error);
      }
    }
    default:
      return null;
  }
}

// =============================================================================
// One-off-payment (checkout mode "payment") extraction
// =============================================================================

function isCheckoutSessionEventType(stripeType: string): boolean {
  return (
    stripeType === StripeEventTypes.checkoutSessionCompleted ||
    stripeType === StripeEventTypes.checkoutSessionAsyncPaymentSucceeded
  );
}

// The session is already paid, so a silent drop means money collected with no
// credit — warn (ids and reason only, no PII) so operators can spot it.
function dropPaidSession(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  reason: string,
): null {
  log.warn("paid checkout session dropped", { eventId: event.id, sessionId: session.id, reason });
  return null;
}

/** Parses a checkout.session.completed / .async_payment_succeeded event into
 *  a PaymentEvent, or null if it isn't a paid one-off-payment session. */
// kumiko-lint-ignore complexity-budget optional-field spreads over the session, one branch per optional provider field
async function parsePaymentEvent(
  event: Stripe.Event,
  stripe: Stripe,
): Promise<PaymentEvent | null> {
  const session = event.data.object as Stripe.Checkout.Session; // @cast-boundary engine-bridge
  // mode !== "payment" excludes subscription-checkout sessions (same event types);
  // payment_status !== "paid" excludes an unpaid/expired session. Null here — not an
  // error — maps to foundation's 200 "ignored", same as the subscription-path's filters.
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return null;
  }

  // Lazy-fetch with expand: the raw webhook payload carries neither
  // line_items (needed for priceId) nor an expanded payment_intent (needed
  // for tenantId — see below). Same lazy-fetch pattern as
  // extractSubscriptionFromEvent's invoice-branch above, null only for resource_missing
  // (session gone between webhook + retrieve), other failures reject with 503.
  let expanded: Stripe.Checkout.Session;
  try {
    expanded = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items", "payment_intent"],
    });
  } catch (error) {
    if (isResourceMissingStripeError(error)) return null;
    throw transientProviderRejection(error);
  }

  // Tenant-resolution: mode:"payment" checkout sessions carry tenantId on
  // the PaymentIntent's OWN metadata (plugin-methods.ts sets it via
  // payment_intent_data.metadata), NOT on session-level metadata —
  // session.metadata is unset for this mode. Reading it off the expanded,
  // Stripe-verified PaymentIntent (not a freely-choosable payload field) is
  // what keeps tenant-attribution trustworthy: the webhook signature proves
  // this whole object chain came from Stripe, and the metadata itself was
  // set by our own backend at checkout-creation time.
  const paymentIntent = expanded.payment_intent;
  if (!paymentIntent || typeof paymentIntent === "string") {
    // Not expanded (Stripe-API-drift) or absent — no verified tenant-claim
    // to trust.
    return dropPaidSession(event, session, "payment_intent_not_expanded");
  }
  const tenantId = paymentIntent.metadata?.["tenantId"];
  if (!tenantId || tenantId.length === 0) {
    return dropPaidSession(event, session, "missing_tenant_id");
  }

  const priceId = expanded.line_items?.data[0]?.price?.id;
  if (!priceId) {
    return dropPaidSession(event, session, "missing_price_id");
  }

  // providerCustomerId: session.customer is null for guest checkouts (no
  // customer_creation configured) — fall back to the PaymentIntent's own
  // customer, which Stripe sets independently of the session-level field.
  const sessionCustomer = expanded.customer;
  const providerCustomerId =
    (typeof sessionCustomer === "string" ? sessionCustomer : sessionCustomer?.id) ??
    (typeof paymentIntent.customer === "string"
      ? paymentIntent.customer
      : paymentIntent.customer?.id);
  if (!providerCustomerId) {
    return dropPaidSession(event, session, "missing_customer");
  }

  const consentId = parseProviderConsentId(paymentIntent.metadata?.["consentId"]);
  return {
    kind: BillingEventKinds.payment,
    providerEventId: event.id,
    providerName: STRIPE_PROVIDER_NAME,
    tenantId,
    ...(consentId !== undefined && { consentId }),
    providerCheckoutId: session.id,
    providerCustomerId,
    priceId,
  };
}
