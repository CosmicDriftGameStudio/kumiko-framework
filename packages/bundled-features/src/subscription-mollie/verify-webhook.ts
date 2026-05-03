// verifyAndParseMollieWebhook — Mollie-spezifische lazy-fetch +
// event-type-Heuristik. Wird vom Plugin-Build (feature.ts) als
// `verifyAndParseWebhook` registriert.
//
// **Drei Schritte:**
//   1. Body parsen (form-urlencoded oder JSON, beides supported).
//      Wir extrahieren die `id`. KEINE sig-verify (Mollie-SDK 4.5.0
//      hat keine native API dafür; Sicherheit kommt aus nicht-
//      guessable IDs + API-Validation, App-Builder kann zusätzlich
//      URL-Token-Wrapper davor schalten).
//   2. ID-Prefix entscheidet lazy-fetch-Pfad:
//        - `tr_xxx`  → payment fetchen, dann subscription via
//                      payment.subscriptionId
//        - `sub_xxx` → subscription direkt fetchen
//   3. Subscription → SubscriptionEvent normalisieren (status-mapping,
//      tier aus metadata.priceId via priceToTier-Map).

import {
  type SubscriptionEvent,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@kumiko/bundled-features/subscription-foundation";
import type {
  Payment as MolliePayment,
  Subscription as MollieSubscription,
} from "@mollie/api-client";
import { MOLLIE_PROVIDER_NAME } from "./constants";

// Minimal-Type-Subset, das wir vom Mollie-Client brauchen — testbar via
// vi.spyOn ohne den vollen MollieClient zu mocken.
export type MollieFetchClient = {
  readonly payments: { readonly get: (id: string) => Promise<MolliePayment> };
  readonly customerSubscriptions: {
    readonly get: (subId: string, customerId: string) => Promise<MollieSubscription>;
  };
};

// =============================================================================
// Sig-verify + parse
// =============================================================================

export type MollieWebhookOptions = {
  /** Price-to-tier-Map. Plugin liest die price-id aus dem subscription-
   *  metadata-Field und mapped auf einen tier-name. Mollie hat keinen
   *  nativen price-id-Konzept (subscriptions sind amount + interval),
   *  daher konvention: App-Builder setzt beim createCheckoutSession
   *  `metadata.priceId` als virtuellen Schlüssel. */
  readonly priceToTier: Readonly<Record<string, string>>;
};

export function verifyAndParseMollieWebhook(
  client: MollieFetchClient,
  options: MollieWebhookOptions,
): (rawBody: string, headers: Record<string, string>) => Promise<SubscriptionEvent | null> {
  return async (rawBody, headers) => {
    // 1. Body parsen — Mollie sendet entweder form-urlencoded
    //    (`id=tr_xxx`) oder JSON (`{"id":"tr_xxx"}`). Content-Type-
    //    header entscheidet.
    const id = extractMollieId(rawBody, headers);
    if (!id) {
      throw new Error("subscription-mollie: webhook body has no `id` field");
    }

    // 2. ID-Prefix entscheidet fetch-Pfad
    let subscription: MollieSubscription | null = null;
    let triggerPayment: MolliePayment | null = null;

    if (id.startsWith("tr_")) {
      // payment-event → fetch payment, dann subscription
      let payment: MolliePayment;
      try {
        payment = await client.payments.get(id);
      } catch {
        // Garbage-id → Mollie-API 404. Foundation 200 ignored —
        // attacker bekommt nichts, valid-IDs werden korrekt verarbeitet.
        return null;
      }
      triggerPayment = payment;
      const subscriptionId = payment.subscriptionId;
      const customerId = payment.customerId;
      if (!subscriptionId || !customerId) {
        // Payment ohne subscription-context (= one-shot-payment, nicht
        // unsere Domain).
        return null;
      }
      try {
        subscription = await client.customerSubscriptions.get(subscriptionId, customerId);
      } catch {
        return null;
      }
    } else if (id.startsWith("sub_")) {
      // subscription-event direkt — Mollie kennt Customer aus
      // subscription.customerId, aber `customerSubscriptions.get`
      // braucht customerId als arg. Workaround: try fetch ohne customer
      // und Mollie-SDK error inspizieren — geht nicht direkt. Daher:
      // der App-Builder bekommt diese events nur indirekt über
      // payment-events (= recurring renewals + cancellations werden
      // über sub_xxx-events triggered ABER Mollie sendet auch
      // tr_xxx-events parallel). Wenn nur sub_xxx kommt, behandeln wir
      // das defensive: null returnen + Doku, App-Builder kann eigenen
      // wrapper bauen wenn er's braucht.
      return null;
    } else {
      // Unbekannte ID-Form
      return null;
    }

    // 3. Tenant-resolution + tier-resolution aus subscription.metadata
    const metadata = (subscription.metadata as Record<string, string> | null) ?? {};
    const tenantId = metadata["tenantId"];
    if (!tenantId || tenantId.length === 0) {
      // Subscription ohne tenant-metadata → kein App-Owner-Bug-recover
      return null;
    }
    const priceId = metadata["priceId"];
    if (!priceId) {
      return null;
    }
    const tier = options.priceToTier[priceId];
    if (!tier) {
      return null;
    }

    // 4. Event-type-Heuristik
    const type = mapMollieEventType(subscription, triggerPayment);
    if (!type) {
      return null;
    }

    // 5. Status-Mapping + period-end (= nextPaymentDate, ISO YYYY-MM-DD)
    const status = mapMollieStatus(subscription.status);
    const currentPeriodEnd = mollieDateStringToInstantIso(
      subscription.nextPaymentDate ?? subscription.startDate,
    );

    return {
      providerEventId: id,
      providerName: MOLLIE_PROVIDER_NAME,
      type,
      tenantId,
      providerCustomerId: subscription.customerId,
      providerSubscriptionId: subscription.id,
      status,
      tier,
      currentPeriodEnd,
      rawPayload: JSON.stringify({ webhookId: id, subscription, triggerPayment }),
    };
  };
}

// =============================================================================
// Helpers (exported für Tests)
// =============================================================================

/** Extract `id` aus rawBody — handelt form-urlencoded + JSON. */
export function extractMollieId(rawBody: string, headers: Record<string, string>): string | null {
  const contentType = headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as { id?: unknown };
      return typeof parsed.id === "string" ? parsed.id : null;
    } catch {
      return null;
    }
  }
  // Default: form-urlencoded (Mollie's classic-webhook)
  const params = new URLSearchParams(rawBody);
  return params.get("id");
}

/** Mollie-subscription + optional payment → SubscriptionEventType.
 *  Heuristik (Mollie hat keine explicit-typed events). */
export function mapMollieEventType(
  subscription: MollieSubscription,
  triggerPayment: MolliePayment | null,
): SubscriptionEventType | null {
  // Subscription-status terminal? → canceled
  if (subscription.status === "canceled" || subscription.status === "completed") {
    return SubscriptionEventTypes.canceled;
  }

  // Wenn der webhook von einem payment kam, nutzen wir sequenceType +
  // payment.status um zu unterscheiden (created vs invoicePaid vs failed).
  if (triggerPayment) {
    const seq = triggerPayment.sequenceType;
    const paid = triggerPayment.status === "paid";
    const failed = triggerPayment.status === "failed" || triggerPayment.status === "expired";
    if (seq === "first" && paid) return SubscriptionEventTypes.created;
    if (seq === "recurring" && paid) return SubscriptionEventTypes.invoicePaid;
    if (seq === "recurring" && failed) return SubscriptionEventTypes.invoicePaymentFailed;
  }

  // Default für aktive Subs ohne expliziten payment-context: updated.
  // (z.B. wenn metadata.priceId sich ändert über die API.)
  if (subscription.status === "active") return SubscriptionEventTypes.updated;
  return null;
}

/** Mollie-status → normalized. Defensive: unbekannt → incomplete. */
export function mapMollieStatus(mollieStatus: MollieSubscription["status"]): SubscriptionStatus {
  switch (mollieStatus) {
    case "active":
      return SubscriptionStatuses.active;
    case "canceled":
    case "completed":
      // completed = alle `times`-charges durchgelaufen (= sub ist fertig).
      // Aus Foundation-sicht ist das wie canceled — kein active-state mehr.
      return SubscriptionStatuses.canceled;
    case "suspended":
      // Mandate ungültig oder payment-method failed → grace-period.
      return SubscriptionStatuses.pastDue;
    case "pending":
      // Mandate noch nicht confirmed → noch keine charges.
      return SubscriptionStatuses.incomplete;
    default:
      return SubscriptionStatuses.incomplete;
  }
}

/** Mollie liefert dates als YYYY-MM-DD; foundation will ISO-Instant. */
function mollieDateStringToInstantIso(dateString: string): string {
  // YYYY-MM-DD + T00:00:00Z → valid ISO-instant
  // Defensive für leere/malformed strings: epoch fallback.
  if (!dateString || dateString.length < 10) {
    return Temporal.Instant.fromEpochMilliseconds(0).toString();
  }
  const isoCandidate = `${dateString.slice(0, 10)}T00:00:00Z`;
  try {
    return Temporal.Instant.from(isoCandidate).toString();
  } catch {
    return Temporal.Instant.fromEpochMilliseconds(0).toString();
  }
}
