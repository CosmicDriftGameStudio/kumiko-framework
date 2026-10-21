// verifyAndParseMollieWebhook: Mollie-specific lazy fetch plus event-type
// heuristic. The plugin build (feature.ts) registers it as
// `verifyAndParseWebhook`.
//
// Mollie's classic webhook sends only an `id` (form-urlencoded or JSON), so
// the payment and subscription are lazily fetched through the Mollie API.
// sub_xxx events are NOT supported; app builders get them indirectly through
// tr_xxx payment events (Mollie sends both in parallel for normal lifecycle
// events).
//
// **Mandate setup flow:** the first paid payment arrives with
// `payment.subscriptionId === null` (Mollie's pattern: the app builder must
// call `customerSubscriptions.create` itself). The plugin does that
// (idempotent via a list check) so the foundation receives a created event
// with a subscription id.

import {
  parseProviderConsentId,
  type SubscriptionEvent,
  type SubscriptionEventType,
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type {
  Payment as MolliePayment,
  Subscription as MollieSubscription,
} from "@mollie/api-client";
import { MOLLIE_PROVIDER_NAME } from "./constants.ts";
import type { MolliePriceConfig } from "./plugin-methods.ts";

const log = createFallbackLogger("subscription-mollie");

/** Minimal subset of the Mollie client used by the plugin — kept separate
 *  so tests can mock it without the full MollieClient. The adapter in
 *  feature.ts bridges it to the real SDK. */
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
  /** priceId (= virtual key from subscription.metadata) → tier name. */
  readonly priceToTier: Readonly<Record<string, string>>;
  /** priceId → amount/interval/description. Needed for the mandate-setup
   *  flow's `customerSubscriptions.create` call. The app builder maintains
   *  this map once in the factory options. */
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
        // One-shot or first-payment-failed events are outside our domain.
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
      // Mollie API drift: valid subscriptions have at least startDate. Fail
      // loudly so the app owner's monitoring can detect the drift.
      throw new Error(
        `subscription-mollie: subscription ${subscription.id} has neither nextPaymentDate nor startDate`,
      );
    }
    const currentPeriodEnd = mollieDateStringToInstantIso(periodEndSource);

    const consentId = parseProviderConsentId(metadata["consentId"]);
    return {
      providerEventId: id,
      providerName: MOLLIE_PROVIDER_NAME,
      type,
      tenantId,
      ...(consentId !== undefined && { consentId }),
      providerCustomerId: subscription.customerId,
      providerSubscriptionId: subscription.id,
      status,
      tier,
      currentPeriodEnd,
    };
  };
}

// =============================================================================
// Mandate-setup: subscription on-the-fly erstellen
// =============================================================================

/** `first-payment-paid` without subscriptionId → create a Mollie subscription.
 *  Idempotent via a list check (replay-safe). Returns null for incomplete
 *  metadata or an unknown priceId. */
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
  const consentId = parseProviderConsentId(paymentMetadata["consentId"]);
  if (!tenantId || !priceId) return null;
  const priceCfg = options.priceToConfig[priceId];
  if (!priceCfg) return null;
  if (!priceCfg.interval) {
    log.warn("price has no interval, no subscription created", { priceId });
    return null;
  }

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
    metadata: { tenantId, priceId, ...(consentId && { consentId }) },
  });
}

// =============================================================================
// Helpers (exported for tests)
// =============================================================================

/** Extracts `id` from rawBody — supports form-urlencoded and JSON. */
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

/** Mollie subscription + optional payment → SubscriptionEventType.
 *  Heuristic because Mollie has no explicitly typed events. */
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
      // completed = all `times` charges have run → treat it like canceled.
      return SubscriptionStatuses.canceled;
    case "suspended":
      // Invalid mandate / payment method failed → grace period.
      return SubscriptionStatuses.pastDue;
    case "pending":
      return SubscriptionStatuses.incomplete;
    default:
      return SubscriptionStatuses.incomplete;
  }
}

/** Mollie provides dates as YYYY-MM-DD; Foundation requires an ISO Instant.
 *  Throws on malformed input (= Mollie API drift, which should fail loudly). */
function mollieDateStringToInstantIso(dateString: string): string {
  return Temporal.Instant.from(`${dateString.slice(0, 10)}T00:00:00Z`).toString();
}
