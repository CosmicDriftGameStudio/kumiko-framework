// Unit-Tests für verifyAndParseStripeWebhook. Nutzt stripe.webhooks.
// generateTestHeaderString um valid sigs zu erzeugen — kein Mock,
// echter Stripe-SDK-roundtrip.
//
// Stripe-Event-Fixtures sind hier minimale Stripe-payloads die nur
// die Felder enthalten die der Plugin tatsächlich liest. Real Stripe-
// events sind >100 Felder; full-fidelity-fixtures wären Maintenance-
// Aufwand ohne Test-Wert.

import {
  SubscriptionEventTypes,
  SubscriptionStatuses,
} from "@kumiko/bundled-features/subscription-foundation";
import Stripe from "stripe";
import { describe, expect, test } from "vitest";
import {
  mapStripeEventType,
  mapStripeStatus,
  verifyAndParseStripeWebhook,
} from "../verify-webhook";

const TEST_SECRET = "whsec_test_secret_12345";
const TEST_API_KEY = "sk_test_dummy_apikey";

// =============================================================================
// Test-helpers
// =============================================================================

const stripeForFixtures = new Stripe(TEST_API_KEY, { apiVersion: "2026-04-22.dahlia" });

function buildSubscriptionEvent(overrides: {
  eventType?: string;
  eventId?: string;
  tenantId?: string;
  status?: string;
  priceId?: string;
  customerId?: string;
  subscriptionId?: string;
  currentPeriodEndUnix?: number;
}) {
  const eventId = overrides.eventId ?? "evt_test_001";
  const eventType = overrides.eventType ?? "customer.subscription.created";
  const subscriptionId = overrides.subscriptionId ?? "sub_test_001";
  const customerId = overrides.customerId ?? "cus_test_001";
  const periodEnd = overrides.currentPeriodEndUnix ?? 1_780_000_000;

  return {
    id: eventId,
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: 1_770_000_000,
    type: eventType,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: customerId,
        status: overrides.status ?? "active",
        metadata: {
          tenantId: overrides.tenantId ?? "tenant-test-1",
        },
        items: {
          object: "list",
          data: [
            {
              id: "si_test",
              object: "subscription_item",
              current_period_end: periodEnd,
              price: {
                id: overrides.priceId ?? "price_pro_monthly",
                object: "price",
              },
            },
          ],
          has_more: false,
        },
      },
    },
  };
}

/** Erstellt einen valid Stripe-signed-Header für ein gegebenes payload. */
function signEvent(payload: string, secret = TEST_SECRET): string {
  return stripeForFixtures.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
}

// =============================================================================
// Sig-verify
// =============================================================================

describe("verifyAndParseStripeWebhook — sig-verify", () => {
  const verify = verifyAndParseStripeWebhook(stripeForFixtures, {
    webhookSecret: TEST_SECRET,
    priceToTier: { price_pro_monthly: "pro" },
  });

  test("happy path: valid sig + bekannter event-type → SubscriptionEvent", async () => {
    const payload = JSON.stringify(buildSubscriptionEvent({}));
    const sig = signEvent(payload);

    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).not.toBeNull();
    expect(event?.providerName).toBe("stripe");
    expect(event?.providerEventId).toBe("evt_test_001");
    expect(event?.type).toBe(SubscriptionEventTypes.created);
    expect(event?.tenantId).toBe("tenant-test-1");
    expect(event?.tier).toBe("pro");
  });

  test("missing stripe-signature header → throws", async () => {
    const payload = JSON.stringify(buildSubscriptionEvent({}));
    await expect(verify(payload, {})).rejects.toThrow(/stripe-signature header missing/);
  });

  test("wrong secret → sig-verify failed → throws", async () => {
    const payload = JSON.stringify(buildSubscriptionEvent({}));
    const sig = signEvent(payload, "whsec_wrong_secret");
    await expect(verify(payload, { "stripe-signature": sig })).rejects.toThrow(
      /signature verify failed/,
    );
  });

  test("modified body → sig-verify failed (Replay-Protection)", async () => {
    const original = JSON.stringify(buildSubscriptionEvent({}));
    const sig = signEvent(original);
    // Tamper with body — Stripe-sig matched die exakten bytes.
    const tampered = original.replace("tenant-test-1", "tenant-attacker");
    await expect(verify(tampered, { "stripe-signature": sig })).rejects.toThrow(
      /signature verify failed/,
    );
  });
});

// =============================================================================
// Event-filter + payload-extraction
// =============================================================================

describe("verifyAndParseStripeWebhook — event-filter", () => {
  const verify = verifyAndParseStripeWebhook(stripeForFixtures, {
    webhookSecret: TEST_SECRET,
    priceToTier: { price_pro_monthly: "pro" },
  });

  test("unbekannter event-type → null (foundation 200 ignored)", async () => {
    // customer.created ist gültiger Stripe-event aber nicht in unserer
    // 5-types-Whitelist.
    const payload = JSON.stringify(buildSubscriptionEvent({ eventType: "customer.created" }));
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });

  test("subscription.updated → SubscriptionEventTypes.updated", async () => {
    const payload = JSON.stringify(
      buildSubscriptionEvent({ eventType: "customer.subscription.updated" }),
    );
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event?.type).toBe(SubscriptionEventTypes.updated);
  });

  test("subscription.deleted → SubscriptionEventTypes.canceled", async () => {
    const payload = JSON.stringify(
      buildSubscriptionEvent({
        eventType: "customer.subscription.deleted",
        status: "canceled",
      }),
    );
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event?.type).toBe(SubscriptionEventTypes.canceled);
    expect(event?.status).toBe(SubscriptionStatuses.canceled);
  });

  test("invoice-event ohne subscription-reference → null (one-shot-invoice)", async () => {
    // Drift-Pin: Stripe one-shot-invoice (nicht recurring). Plugin
    // versucht NICHT zu lazy-fetchen weil's keine sub-id zum fetchen
    // gibt. Foundation 200 ignored.
    const ev = {
      id: "evt_invoice_oneshot",
      object: "event",
      api_version: "2026-04-22.dahlia",
      created: 1_770_000_000,
      type: "invoice.paid",
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "in_001",
          object: "invoice",
          subscription: null,
        },
      },
    };
    const payload = JSON.stringify(ev);
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });
});

// =============================================================================
// Tenant-resolution + price-to-tier
// =============================================================================

describe("verifyAndParseStripeWebhook — tenant-resolution + price-to-tier", () => {
  const verify = verifyAndParseStripeWebhook(stripeForFixtures, {
    webhookSecret: TEST_SECRET,
    priceToTier: { price_pro_monthly: "pro", price_business_yearly: "business" },
  });

  test("metadata.tenantId fehlt → null (App-Owner-Bug, foundation 200 ignored)", async () => {
    const ev = buildSubscriptionEvent({});
    // @ts-expect-error — entferne metadata für Test
    ev.data.object.metadata = {};
    const payload = JSON.stringify(ev);
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });

  test("price-id im Mapping → korrekter tier-Wert", async () => {
    const payload = JSON.stringify(buildSubscriptionEvent({ priceId: "price_business_yearly" }));
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event?.tier).toBe("business");
  });

  test("price-id NICHT im Mapping → null", async () => {
    const payload = JSON.stringify(buildSubscriptionEvent({ priceId: "price_unknown_xyz" }));
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });

  test("currentPeriodEnd wird aus subscription.items[0].current_period_end (Unix-sec) zu ISO konvertiert", async () => {
    const periodEndUnix = 1_780_000_000;
    const payload = JSON.stringify(buildSubscriptionEvent({ currentPeriodEndUnix: periodEndUnix }));
    const sig = signEvent(payload);
    const event = await verify(payload, { "stripe-signature": sig });
    // 1_780_000_000 sec = 2026-05-28T20:26:40Z (in ms: 1.78e12)
    // Temporal.Instant.toString() droppt Trailing-Zeros — keine .000Z
    expect(event?.currentPeriodEnd).toBe("2026-05-28T20:26:40Z");
  });
});

// =============================================================================
// Mapping-helpers (pure functions, kein Stripe-mock nötig)
// =============================================================================

describe("mapStripeEventType — drift-pin pro mapping", () => {
  test("alle 5 Stripe-event-types → SubscriptionEventTypes", () => {
    expect(mapStripeEventType("customer.subscription.created")).toBe(
      SubscriptionEventTypes.created,
    );
    expect(mapStripeEventType("customer.subscription.updated")).toBe(
      SubscriptionEventTypes.updated,
    );
    expect(mapStripeEventType("customer.subscription.deleted")).toBe(
      SubscriptionEventTypes.canceled,
    );
    expect(mapStripeEventType("invoice.paid")).toBe(SubscriptionEventTypes.invoicePaid);
    expect(mapStripeEventType("invoice.payment_failed")).toBe(
      SubscriptionEventTypes.invoicePaymentFailed,
    );
  });

  test("alles andere → null", () => {
    expect(mapStripeEventType("customer.created")).toBeNull();
    expect(mapStripeEventType("checkout.session.completed")).toBeNull();
    expect(mapStripeEventType("ping")).toBeNull();
  });
});

describe("mapStripeStatus — Stripe-status → normalized", () => {
  test("active/trialing direkt", () => {
    expect(mapStripeStatus("active")).toBe(SubscriptionStatuses.active);
    expect(mapStripeStatus("trialing")).toBe(SubscriptionStatuses.trialing);
  });

  test("past_due / unpaid / paused → past_due (= grace-period im Plattform-Tier)", () => {
    // Drift-Pin: alle drei Stripe-grace-Status werden auf den einen
    // normalisierten "past_due"-Status mapped. Wenn Stripe einen vierten
    // grace-Status einführt müssen wir den explizit hinzufügen statt
    // auf "incomplete" fallback'n (= würde tenant downgraden).
    expect(mapStripeStatus("past_due")).toBe(SubscriptionStatuses.pastDue);
    expect(mapStripeStatus("unpaid")).toBe(SubscriptionStatuses.pastDue);
    expect(mapStripeStatus("paused")).toBe(SubscriptionStatuses.pastDue);
  });

  test("canceled → canceled", () => {
    expect(mapStripeStatus("canceled")).toBe(SubscriptionStatuses.canceled);
  });

  test("incomplete / incomplete_expired → incomplete", () => {
    expect(mapStripeStatus("incomplete")).toBe(SubscriptionStatuses.incomplete);
    expect(mapStripeStatus("incomplete_expired")).toBe(SubscriptionStatuses.incomplete);
  });
});
