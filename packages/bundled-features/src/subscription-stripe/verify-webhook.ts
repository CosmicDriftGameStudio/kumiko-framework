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
//
// **Runtime-keys (pre-tenant):** api-key + webhook-secret kommen NICHT
// mehr aus einem mount-time-Closure, sondern werden zur Webhook-Zeit aus
// dem `StripeWebhookRuntime` aufgelöst. Der foundation-webhook-handler
// reicht einen system-scoped SecretsContext als 3. Arg durch; der runtime
// liest beide Keys daraus (un-audited, system-internal) mit Fallback auf
// die factory-options. Damit rotiert ein Key ohne Redeploy — und der
// invoice-lazy-fetch (unten) nutzt denselben rotierten Client wie der
// sig-verify, kein split-brain.
//
// **Invoice-event lazy-fetch:**
// Bei `invoice.paid` und `invoice.payment_failed` enthält der webhook-
// payload nur die subscription-id (Stripe-Webhooks expanden subscription
// nicht automatisch). Plugin macht einen lazy-fetch via
// `stripe.subscriptions.retrieve(subId)` um an das full subscription-
// Object für status/tier/period-end-mapping zu kommen. Bei Stripe-API-
// failure (= subscription gelöscht zwischen webhook + retrieve)
// returnt der Plugin defensiv null — der nächste subscription-event
// wird den state korrekt handhaben.

import type { SubscriptionEvent } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import {
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type Stripe from "stripe";
import { STRIPE_PROVIDER_NAME, StripeEventTypes } from "./constants";
import type { StripeWebhookRuntime } from "./runtime";

// =============================================================================
// Sig-verify + parse
// =============================================================================

export type StripeWebhookOptions = {
  /** Price-to-tier-Map. Plugin liest die price-id aus dem event und
   *  mapped auf tier-name. Fehlt die price-id im Mapping → null. App-
   *  spezifisch, bleibt eine factory-option (kein Secret). */
  readonly priceToTier: Readonly<Record<string, string>>;
};

/**
 * Stripe-webhook-handler. Implementiert den Plugin-Contract
 * `verifyAndParseWebhook`. **Pre-tenant-resolution** — kein
 * HandlerContext; statt eines mount-time-Clients löst der `runtime` den
 * Stripe-Client + das webhook-secret zur Call-Zeit aus dem optionalen
 * system-SecretsContext (3. Arg) auf.
 */
export function verifyAndParseStripeWebhook(
  runtime: StripeWebhookRuntime,
  options: StripeWebhookOptions,
): (
  rawBody: string,
  headers: Record<string, string>,
  systemSecrets?: SecretsContext,
) => Promise<SubscriptionEvent | null> {
  return async (rawBody, headers, systemSecrets) => {
    const sigHeader = headers["stripe-signature"];
    if (!sigHeader) {
      throw new Error("subscription-stripe: stripe-signature header missing");
    }

    // 0. Runtime-resolve: api-key (für client + lazy-fetch) + webhook-
    //    secret (für sig-verify) aus system-secrets, Fallback factory-
    //    options. Wirft wenn beide unkonfiguriert.
    const { stripe, webhookSecret } = await runtime.resolve(systemSecrets);

    // 1. Sig-verify. constructEvent throws bei mismatch (= invalid sig)
    //    oder timestamp-tolerance-violation (default 5min). Foundation
    //    mapped throw → HTTP 401.
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sigHeader, webhookSecret);
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
    //    oder via lazy-fetch (invoice-events).
    const sub = await extractSubscriptionFromEvent(event, stripe);
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
 *  direkt im data.object; invoice-events haben nur die subscription-id
 *  und brauchen einen lazy-fetch via stripe.subscriptions.retrieve. */
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
      // Lazy-fetch der subscription. invoice.subscription ist eine
      // string-id (Stripe-Webhooks expanden nicht auto). Wir holen das
      // full subscription-Object damit der downstream-mapping
      // (status, tier via priceId, period-end) konsistent funktioniert.
      const invoice = event.data.object as Stripe.Invoice; // @cast-boundary engine-bridge
      const subRef = (invoice as { subscription?: string | Stripe.Subscription | null }) // @cast-boundary engine-payload
        .subscription;
      if (!subRef) {
        // Invoice ohne subscription-reference (= one-shot-invoice, nicht
        // recurring). Nicht unsere Domain — ignorieren.
        return null;
      }
      const subId = typeof subRef === "string" ? subRef : subRef.id;
      try {
        return await stripe.subscriptions.retrieve(subId);
      } catch {
        // Stripe-API-failure beim retrieve (z.B. subscription gelöscht
        // zwischen webhook + retrieve). Defensive: null returnen, damit
        // foundation 200 ignored returnt — der nächste subscription-
        // event wird's korrekt handhaben.
        return null;
      }
    }
    default:
      return null;
  }
}
