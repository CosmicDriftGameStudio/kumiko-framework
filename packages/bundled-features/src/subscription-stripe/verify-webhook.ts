// verifyAndParseStripeWebhook — Stripe-spezifische sig-verify +
// event-mapping. Wird vom Plugin-Build (feature.ts) als
// `verifyAndParseWebhook` registriert.
//
// **Drei Schritte:**
//   1. Sig-verify via stripe.webhooks.constructEvent (HMAC-SHA-256
//      gegen rawBody + Stripe-Signature-Header). Wirft bei mismatch
//      oder älter als 5min (Replay-Protection).
//   2. Event-type-Filter: nur die 5 event-types die wir auf
//      SubscriptionEventTypes mappen kommen weiter; alles andere
//      returnt null (foundation antwortet 200 ignored).
//   3. Stripe-payload → SubscriptionEvent normalisieren
//      (status-mapping, tenant-id aus metadata, price-to-tier-Lookup).

import type { SubscriptionEvent } from "@kumiko/bundled-features/subscription-foundation";
import {
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@kumiko/bundled-features/subscription-foundation";
import Stripe from "stripe";
import { STRIPE_PROVIDER_NAME, StripeEventTypes } from "./constants";

// =============================================================================
// Sig-verify + parse
// =============================================================================

export type StripeWebhookOptions = {
  /** Webhook-secret aus dem Stripe-Dashboard. **App-wide**, nicht
   *  per-tenant. Liest aus ENV-VAR oder system-config beim Plugin-
   *  build. */
  readonly webhookSecret: string;
  /** Stripe-API-key (sk_live_... / sk_test_...). Wird hier nicht für
   *  sig-verify gebraucht aber weitergereicht für Phase 5.2b
   *  (createPortalSession etc). */
  readonly apiKey: string;
  /** Price-to-tier-Map. Plugin liest die price-id aus dem event und
   *  mapped auf tier-name. Fehlt die price-id im Mapping → null. */
  readonly priceToTier: Readonly<Record<string, string>>;
};

/**
 * Stripe-webhook-handler. Implementiert den Plugin-Contract
 * `verifyAndParseWebhook`. Closure über die `options` (kein ctx-arg —
 * das ist die Pre-tenant-resolution-Phase).
 */
export function verifyAndParseStripeWebhook(
  options: StripeWebhookOptions,
): (rawBody: string, headers: Record<string, string>) => Promise<SubscriptionEvent | null> {
  // Stripe-client für constructEvent. apiVersion explizit pinnen damit
  // der Plugin nicht silent breaks wenn Stripe-SDK ihre default-version
  // bumpt.
  const stripe = new Stripe(options.apiKey, { apiVersion: "2026-04-22.dahlia" });

  return async (rawBody, headers) => {
    const sigHeader = headers["stripe-signature"];
    if (!sigHeader) {
      throw new Error("subscription-stripe: stripe-signature header missing");
    }

    // 1. Sig-verify. constructEvent throws bei mismatch (= invalid sig)
    //    oder timestamp-tolerance-violation (default 5min). Foundation
    //    mapped throw → HTTP 401.
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sigHeader, options.webhookSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`subscription-stripe: webhook signature verify failed — ${msg}`);
    }

    // 2. Event-type-Filter — wir kennen nur 5.
    const normalizedType = mapStripeEventType(event.type);
    if (!normalizedType) {
      return null; // foundation returnt 200 ignored
    }

    // 3. Payload-extraction. Stripe liefert je nach event.type
    //    verschiedene data.object-shapes. Wir extrahieren die
    //    Subscription-Daten — entweder direkt (subscription-events)
    //    oder via .subscription-Reference (invoice-events).
    const sub = extractSubscriptionFromEvent(event);
    if (!sub) {
      // event-type war unter den 5 (oben gefiltert), aber payload-shape
      // matched nicht — Stripe-SDK-Schema-Drift, defensive null.
      return null;
    }

    // 4. Tenant-resolution aus metadata. App-Builder setzt
    //    `metadata.tenantId` beim createCheckoutSession-call.
    const tenantId = sub.metadata?.["tenantId"];
    if (!tenantId || tenantId.length === 0) {
      // Subscription ohne tenant-metadata → kann kein subscription
      // erstellen ohne tenant-resolution. Drop the event silent
      // (foundation 200 ignored). App-Owner-Bug, nicht foundation-Bug.
      return null;
    }

    // 5. Price-to-tier-Mapping. Stripe-subscription hat items[0].price.id.
    const priceId = sub.items.data[0]?.price.id;
    if (!priceId) {
      return null;
    }
    const tier = options.priceToTier[priceId];
    if (!tier) {
      // Price-id nicht im Mapping → App-Owner hat den Stripe-price
      // angelegt aber nicht zur tier zugeordnet. Drop silent.
      return null;
    }

    // 6. Status-Mapping + period-end. Stripe hat den period-end seit
    //    2024 vom subscription-level auf item-level migriert (=
    //    subscription.items.data[i].current_period_end). Wir lesen
    //    das vom ersten item; multi-item-subs (Add-Ons) sind kein
    //    Phase-5-Scope.
    const status = mapStripeStatus(sub.status);
    const periodEndUnixSec = sub.items.data[0]?.current_period_end ?? 0;
    // Stripe returns Unix-seconds; Temporal.Instant.fromEpochMilliseconds
    // expects ms. Multiply, then ISO. (No-Date-API-Guard verbietet
    // `new Date()` — Temporal ist global verfügbar via polyfill.)
    const currentPeriodEnd = Temporal.Instant.fromEpochMilliseconds(
      periodEndUnixSec * 1000,
    ).toString();

    return {
      providerEventId: event.id,
      providerName: STRIPE_PROVIDER_NAME,
      type: normalizedType,
      tenantId,
      providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      providerSubscriptionId: sub.id,
      status,
      tier,
      currentPeriodEnd,
      rawPayload: JSON.stringify(event),
    };
  };
}

// =============================================================================
// Helpers
// =============================================================================

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

/** Stripe-status → normalisiert. Defensive: unbekannte Status →
 *  incomplete (Plugin sollte das nicht erreichen, aber wir wollen
 *  kein ungültiger status-string in der DB). */
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
    case "incomplete":
    case "incomplete_expired":
      return SubscriptionStatuses.incomplete;
    default:
      return SubscriptionStatuses.incomplete;
  }
}

/** Holt die Subscription aus dem Event. Subscription-events haben sie
 *  direkt im data.object; invoice-events haben sie in .subscription. */
function extractSubscriptionFromEvent(event: Stripe.Event): Stripe.Subscription | null {
  switch (event.type) {
    case StripeEventTypes.customerSubscriptionCreated:
    case StripeEventTypes.customerSubscriptionUpdated:
    case StripeEventTypes.customerSubscriptionDeleted:
      return event.data.object as Stripe.Subscription;
    case StripeEventTypes.invoicePaid:
    case StripeEventTypes.invoicePaymentFailed: {
      // invoice.subscription kann string-id, expanded object oder null
      // sein. Für den webhook-flow brauchen wir das full subscription-
      // object. Stripe-Webhooks expanden subscription nicht automatisch
      // (= invoice.subscription ist string-id). In Phase 5.2b: lazy-
      // fetch via stripe.subscriptions.retrieve. Heute returnen wir
      // null und filtern damit alle invoice-events raus solange das
      // nicht implementiert ist — das ist OK, subscription.created/
      // updated/deleted decken den state-update-Pfad ab.
      return null;
    }
    default:
      return null;
  }
}
