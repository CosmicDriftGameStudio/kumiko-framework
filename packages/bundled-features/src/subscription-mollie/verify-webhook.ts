// verifyAndParseMollieWebhook — Mollie-spezifische lazy-fetch +
// event-type-Heuristik. Wird vom Plugin-Build (feature.ts) als
// `verifyAndParseWebhook` registriert.
//
// Mollie's classic-webhook sendet nur eine `id` (form-urlencoded oder
// JSON). Wir lazy-fetchen payment + subscription via Mollie-API. Sub-
// xxx-events werden NICHT supported — App-Builder bekommt sie indirekt
// via tr_xxx-payment-events (Mollie sendet beide parallel bei normalen
// Lifecycle-Events).
//
// **Mandate-setup-flow:** first-payment-paid kommt mit
// `payment.subscriptionId === null` (Mollie's Pattern: App-Builder
// muss `customerSubscriptions.create` selbst aufrufen). Wir machen
// das im Plugin (idempotent via list-check), damit Foundation einen
// Created-Event mit subscription-id bekommt.

import {
  type SubscriptionEvent,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type {
  Payment as MolliePayment,
  Subscription as MollieSubscription,
} from "@mollie/api-client";
import { MOLLIE_PROVIDER_NAME } from "./constants";
import type { MolliePriceConfig } from "./plugin-methods";

/** Minimal-Subset des Mollie-Clients, das der Plugin nutzt — separat
 *  damit Tests ohne den vollen MollieClient mocken können. Adapter in
 *  feature.ts bridged das gegen den echten SDK. */
export type MollieClientShape = {
  readonly payments: { readonly get: (id: string) => Promise<MolliePayment> };
  readonly customerSubscriptions: {
    readonly get: (subId: string, customerId: string) => Promise<MollieSubscription>;
    readonly list: (customerId: string) => Promise<readonly MollieSubscription[]>;
    readonly create: (
      customerId: string,
      params: {
        amount: { currency: string; value: string };
        interval: string;
        description: string;
        metadata: Record<string, string>;
      },
    ) => Promise<MollieSubscription>;
  };
};

export type MollieWebhookOptions = {
  /** priceId (= virtueller Schlüssel aus subscription.metadata) → tier-name. */
  readonly priceToTier: Readonly<Record<string, string>>;
  /** priceId → amount/interval/description. Wird beim mandate-setup-
   *  flow zum `customerSubscriptions.create`-Call gebraucht. App-
   *  Builder pflegt die Map einmal in den factory-options. */
  readonly priceToConfig: Readonly<Record<string, MolliePriceConfig>>;
};

export function verifyAndParseMollieWebhook(
  client: MollieClientShape,
  options: MollieWebhookOptions,
): (rawBody: string, headers: Record<string, string>) => Promise<SubscriptionEvent | null> {
  return async (rawBody, headers) => {
    const id = extractMollieId(rawBody, headers);
    if (!id) {
      throw new Error("subscription-mollie: webhook body has no `id` field");
    }

    let subscription: MollieSubscription | null = null;
    let triggerPayment: MolliePayment | null = null;

    if (id.startsWith("tr_")) {
      let payment: MolliePayment;
      try {
        payment = await client.payments.get(id);
      } catch {
        // Garbage-id → Mollie 404 → Foundation 200 ignored.
        return null;
      }
      triggerPayment = payment;
      const customerId = payment.customerId;
      if (!customerId) return null;

      if (payment.subscriptionId) {
        try {
          subscription = await client.customerSubscriptions.get(payment.subscriptionId, customerId);
        } catch {
          return null;
        }
      } else if (payment.sequenceType === "first" && payment.status === "paid") {
        subscription = await ensureSubscriptionForMandate(client, options, payment);
        if (!subscription) return null;
      } else {
        // One-shot oder first-payment-failed → nicht unsere Domain.
        return null;
      }
    } else if (id.startsWith("sub_")) {
      // sub_xxx-events kommen indirekt via parallele tr_xxx-events.
      return null;
    } else {
      return null;
    }

    const metadata = (subscription.metadata as Record<string, string> | null) ?? {}; // @cast-boundary engine-bridge
    const tenantId = metadata["tenantId"];
    if (!tenantId || tenantId.length === 0) return null;
    const priceId = metadata["priceId"];
    if (!priceId) return null;
    const tier = options.priceToTier[priceId];
    if (!tier) return null;

    const type = mapMollieEventType(subscription, triggerPayment);
    if (!type) return null;

    const status = mapMollieStatus(subscription.status);
    const periodEndSource = subscription.nextPaymentDate ?? subscription.startDate;
    if (!periodEndSource) {
      // Mollie-API-Drift: valid Subs haben mindestens startDate. Loud-
      // fail damit App-Owner's monitoring den drift sieht.
      throw new Error(
        `subscription-mollie: subscription ${subscription.id} has neither nextPaymentDate nor startDate`,
      );
    }
    const currentPeriodEnd = mollieDateStringToInstantIso(periodEndSource);

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
// Mandate-setup: subscription on-the-fly erstellen
// =============================================================================

/** first-payment-paid OHNE subscriptionId → Mollie-Sub erstellen.
 *  Idempotent via list-check (replay-safe). Returns null bei
 *  unvollständiger metadata oder unbekanntem priceId. */
async function ensureSubscriptionForMandate(
  client: MollieClientShape,
  options: MollieWebhookOptions,
  payment: MolliePayment,
): Promise<MollieSubscription | null> {
  const customerId = payment.customerId;
  if (!customerId) return null;
  const paymentMetadata = (payment.metadata as Record<string, string> | null) ?? {}; // @cast-boundary engine-bridge
  const tenantId = paymentMetadata["tenantId"];
  const priceId = paymentMetadata["priceId"];
  if (!tenantId || !priceId) return null;
  const priceCfg = options.priceToConfig[priceId];
  if (!priceCfg) return null;

  const existing = await client.customerSubscriptions.list(customerId);
  const matchingExisting = existing.find(
    (sub) =>
      (sub.metadata as Record<string, string> | null)?.["priceId"] === priceId && // @cast-boundary engine-bridge
      (sub.status === "active" || sub.status === "pending"),
  );
  if (matchingExisting) return matchingExisting;

  return await client.customerSubscriptions.create(customerId, {
    amount: { currency: priceCfg.amountCurrency, value: priceCfg.amountValue },
    interval: priceCfg.interval,
    description: priceCfg.description,
    metadata: { tenantId, priceId },
  });
}

// =============================================================================
// Helpers (exported für Tests)
// =============================================================================

/** Extract `id` aus rawBody — handelt form-urlencoded + JSON. */
export function extractMollieId(rawBody: string, headers: Record<string, string>): string | null {
  const contentType = headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      const id =
        typeof parsed === "object" && parsed !== null && "id" in parsed
          ? (parsed as Record<string, unknown>)["id"] // @cast-boundary engine-payload
          : undefined;
      return typeof id === "string" ? id : null;
    } catch {
      return null;
    }
  }
  const params = new URLSearchParams(rawBody);
  return params.get("id");
}

/** Mollie-subscription + optional payment → SubscriptionEventType.
 *  Heuristik (Mollie hat keine explicit-typed events). */
export function mapMollieEventType(
  subscription: MollieSubscription,
  triggerPayment: MolliePayment | null,
): SubscriptionEventType | null {
  if (subscription.status === "canceled" || subscription.status === "completed") {
    return SubscriptionEventTypes.canceled;
  }

  if (triggerPayment) {
    const seq = triggerPayment.sequenceType;
    const paid = triggerPayment.status === "paid";
    const failed = triggerPayment.status === "failed" || triggerPayment.status === "expired";
    if (seq === "first" && paid) return SubscriptionEventTypes.created;
    if (seq === "recurring" && paid) return SubscriptionEventTypes.invoicePaid;
    if (seq === "recurring" && failed) return SubscriptionEventTypes.invoicePaymentFailed;
  }

  if (subscription.status === "active") return SubscriptionEventTypes.updated;
  return null;
}

/** Mollie-status → normalized. */
export function mapMollieStatus(mollieStatus: MollieSubscription["status"]): SubscriptionStatus {
  switch (mollieStatus) {
    case "active":
      return SubscriptionStatuses.active;
    case "canceled":
    case "completed":
      // completed = alle `times`-charges durchgelaufen → wie canceled.
      return SubscriptionStatuses.canceled;
    case "suspended":
      // Mandate ungültig / payment-method failed → grace-period.
      return SubscriptionStatuses.pastDue;
    case "pending":
      return SubscriptionStatuses.incomplete;
    default:
      return SubscriptionStatuses.incomplete;
  }
}

/** Mollie liefert dates als YYYY-MM-DD; foundation will ISO-Instant.
 *  Throws bei malformed input (= Mollie-API-Drift, soll loud-fail). */
function mollieDateStringToInstantIso(dateString: string): string {
  return Temporal.Instant.from(`${dateString.slice(0, 10)}T00:00:00Z`).toString();
}
