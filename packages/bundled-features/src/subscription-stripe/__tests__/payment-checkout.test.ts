// Unit tests for the one-off-payment branch of verifyAndParseStripeWebhook
// (checkout.session.completed / .async_payment_succeeded). Split out of
// verify-webhook.test.ts — that file's fixtures stay subscription/invoice-
// only, this one owns every checkout.session.* fixture.

import { describe, expect, test } from "bun:test";
import { BillingEventKinds } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import Stripe from "stripe";
import type { StripeWebhookRuntime } from "../runtime";
import { verifyAndParseStripeWebhook } from "../verify-webhook";

const TEST_SECRET = "whsec_test_secret_12345";
const TEST_API_KEY = "sk_test_dummy_apikey";

const stripeForFixtures = new Stripe(TEST_API_KEY);

async function signEvent(payload: string, secret = TEST_SECRET): Promise<string> {
  return stripeForFixtures.webhooks.generateTestHeaderStringAsync({ payload, secret });
}

function buildCheckoutSessionEvent(overrides: {
  eventType?: string;
  eventId?: string;
  sessionId?: string;
  mode?: string;
  paymentStatus?: string;
}) {
  return {
    id: overrides.eventId ?? "evt_checkout_001",
    object: "event",
    api_version: "2026-04-22.dahlia",
    created: 1_770_000_000,
    type: overrides.eventType ?? "checkout.session.completed",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: overrides.sessionId ?? "cs_test_001",
        object: "checkout.session",
        mode: overrides.mode ?? "payment",
        payment_status: overrides.paymentStatus ?? "paid",
      },
    },
  };
}

/** Stub-client: real Stripe.webhooks (sig-verify), fake checkout.sessions.retrieve
 *  (the lazy-fetch). No real network precedent for this call in the suite, so a
 *  stub result is the intended pattern (advisor-endorsed), not a mock-out of
 *  application logic under test. */
function webhookRuntimeWithRetrieve(
  retrieve: () => Promise<unknown>,
  webhookSecret = TEST_SECRET,
): StripeWebhookRuntime {
  const stripe = {
    webhooks: stripeForFixtures.webhooks,
    checkout: { sessions: { retrieve } },
  } as unknown as Stripe; // @cast-boundary engine-bridge
  return { resolve: async () => ({ stripe, webhookSecret }) };
}

function throwingRetrieve(): Promise<never> {
  throw new Error("checkout.sessions.retrieve must not be called for a non-payment/unpaid session");
}

function buildExpandedSession(overrides: {
  sessionId?: string;
  tenantId?: string;
  priceId?: string;
  customerId?: string;
}) {
  return {
    id: overrides.sessionId ?? "cs_test_001",
    customer: overrides.customerId ?? "cus_test_checkout",
    payment_intent: {
      id: "pi_test_001",
      metadata: { tenantId: overrides.tenantId ?? "tenant-test-1" },
      customer: overrides.customerId ?? "cus_test_checkout",
    },
    line_items: {
      object: "list",
      data: [{ id: "li_test_001", price: { id: overrides.priceId ?? "price_topup_test" } }],
    },
  };
}

describe("verifyAndParseStripeWebhook — one-off payment (checkout.session.*)", () => {
  test("mode: 'subscription' → no PaymentEvent, lazy-fetch never called", async () => {
    const verify = verifyAndParseStripeWebhook(webhookRuntimeWithRetrieve(throwingRetrieve), {
      priceToTier: {},
    });
    const payload = JSON.stringify(
      buildCheckoutSessionEvent({ mode: "subscription", paymentStatus: "paid" }),
    );
    const sig = await signEvent(payload);

    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });

  test("checkout.session.completed with payment_status: 'unpaid' → no PaymentEvent", async () => {
    const verify = verifyAndParseStripeWebhook(webhookRuntimeWithRetrieve(throwingRetrieve), {
      priceToTier: {},
    });
    const payload = JSON.stringify(
      buildCheckoutSessionEvent({
        eventType: "checkout.session.completed",
        mode: "payment",
        paymentStatus: "unpaid",
      }),
    );
    const sig = await signEvent(payload);

    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });

  test("checkout.session.async_payment_succeeded, mode: payment, paid → PaymentEvent", async () => {
    const verify = verifyAndParseStripeWebhook(
      webhookRuntimeWithRetrieve(async () => buildExpandedSession({})),
      { priceToTier: {} },
    );
    const payload = JSON.stringify(
      buildCheckoutSessionEvent({
        eventType: "checkout.session.async_payment_succeeded",
        eventId: "evt_checkout_async_001",
        mode: "payment",
        paymentStatus: "paid",
      }),
    );
    const sig = await signEvent(payload);

    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).not.toBeNull();
    if (!event || event.kind !== BillingEventKinds.payment) {
      throw new Error("expected a PaymentEvent");
    }
    expect(event.providerEventId).toBe("evt_checkout_async_001");
    expect(event.providerName).toBe("stripe");
    expect(event.tenantId).toBe("tenant-test-1");
    expect(event.priceId).toBe("price_topup_test");
    expect(event.providerCustomerId).toBe("cus_test_checkout");
  });

  test("checkout.session.completed, mode: payment, paid, missing tenantId metadata → null", async () => {
    const verify = verifyAndParseStripeWebhook(
      webhookRuntimeWithRetrieve(async () => ({
        ...buildExpandedSession({}),
        payment_intent: { id: "pi_test_002", metadata: {}, customer: "cus_test_checkout" },
      })),
      { priceToTier: {} },
    );
    const payload = JSON.stringify(
      buildCheckoutSessionEvent({
        eventType: "checkout.session.completed",
        eventId: "evt_checkout_no_tenant",
        mode: "payment",
        paymentStatus: "paid",
      }),
    );
    const sig = await signEvent(payload);

    const event = await verify(payload, { "stripe-signature": sig });
    expect(event).toBeNull();
  });
});
