// Unit-Tests für die Stripe-Plugin-Methoden (createCheckoutSession,
// createPortalSession, cancelSubscription). Stripe-SDK-calls werden via
// spyOn gemockt — wir testen unsere Mapping-Logik (Argumente die wir
// an Stripe schicken + Antwort-Parsing), NICHT Stripe selbst.
//
// **Runtime-Wrapper:** die methods nehmen jetzt einen StripeCtxRuntime
// (löst Client + billing-live aus ctx auf), nicht mehr einen rohen
// Stripe-Client. `ctxRuntime(stripe, billingLive)` baut einen Test-runtime
// der den gespyten Client zurückgibt — die echte Resolution-Logik testet
// runtime.test.ts.

import { describe, expect, spyOn, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { FeatureDisabledError } from "@cosmicdrift/kumiko-framework/errors";
import Stripe from "stripe";
import { SUBSCRIPTION_STRIPE_FEATURE } from "../constants";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePortalSession,
} from "../plugin-methods";
import type { StripeCtxRuntime } from "../runtime";

const TEST_API_KEY = "sk_test_dummy";

function buildStripe(): Stripe {
  return new Stripe(TEST_API_KEY);
}

/** Test-runtime: gibt den gespyten Client zurück + ein billing-live-Gate
 *  das (default) durchlässt. */
function ctxRuntime(stripe: Stripe, billingLive = true): StripeCtxRuntime {
  return {
    clientForCtx: async () => stripe,
    assertBillingLive: async () => {
      if (!billingLive) {
        throw new FeatureDisabledError(SUBSCRIPTION_STRIPE_FEATURE, "create-checkout-session");
      }
    },
  };
}

const stubCtx = {} as HandlerContext;

// =============================================================================
// createCheckoutSession
// =============================================================================

describe("createStripeCheckoutSession", () => {
  test("ruft stripe.checkout.sessions.create mit mode=subscription + tenant-metadata", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/test" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    const result = await checkout(stubCtx, {
      priceId: "price_pro_monthly",
      tenantId: "tenant-001",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/test" });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      mode: "subscription",
      line_items: [{ price: "price_pro_monthly", quantity: 1 }],
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
      // Drift-Pin: metadata.tenantId LANDET auf der subscription, NICHT
      // auf der checkout-session direkt — sonst kann verifyAndParse-
      // Webhook den tenant beim subsequent webhook nicht resolven.
      subscription_data: {
        metadata: { tenantId: "tenant-001" },
      },
    });
  });

  test("#104-Gate: throws FeatureDisabledError + ruft Stripe NICHT wenn billing-live aus", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://x" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe, false));
    await expect(
      checkout(stubCtx, {
        priceId: "price_x",
        tenantId: "t",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      }),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
    // Kein Stripe-Call — die Schranke greift VOR jeder Session-Erstellung.
    expect(createMock).not.toHaveBeenCalled();
  });

  test("passes existing customer-id wenn gesetzt (Plan-Wechsel-Flow)", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://x" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    await checkout(stubCtx, {
      priceId: "price_x",
      tenantId: "tenant-002",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
      providerCustomerId: "cus_existing_123",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_existing_123" }),
    );
  });

  test("mode='payment': ruft stripe.checkout.sessions.create mit mode=payment + payment_intent_data.metadata (KEIN subscription_data)", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/topup" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    const result = await checkout(stubCtx, {
      priceId: "price_credits_topup",
      tenantId: "tenant-003",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      mode: "payment",
    });

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/topup" });
    expect(createMock).toHaveBeenCalledWith({
      mode: "payment",
      line_items: [{ price: "price_credits_topup", quantity: 1 }],
      success_url: "https://example.com/success",
      cancel_url: "https://example.com/cancel",
      // Drift-Pin: payment-mode carries tenantId via payment_intent_data,
      // NOT subscription_data — Stripe rejects subscription_data outside
      // subscription-mode.
      payment_intent_data: {
        metadata: { tenantId: "tenant-003" },
      },
    });
  });

  test("mode omitted defaults to 'subscription' (Regression-Pin für bestehende Aufrufer)", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://x" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    await checkout(stubCtx, {
      priceId: "price_x",
      tenantId: "tenant-004",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "subscription", subscription_data: expect.anything() }),
    );
  });

  test("throws wenn Stripe keine url returnt (defensive — sollte nie passieren bei mode=subscription)", async () => {
    const stripe = buildStripe();
    spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: SDK-Drift-Test
      .mockResolvedValue({ url: null } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    await expect(
      checkout(stubCtx, {
        priceId: "p",
        tenantId: "t",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      }),
    ).rejects.toThrow(/returned no url/);
  });

  test("Stripe-API-failure (z.B. 500 / network) → propagated zum Caller (Foundation mapped auf 500)", async () => {
    // Drift-Pin: Plugin schluckt KEINE Stripe-Errors. Foundation
    // verlässt sich darauf dass create-checkout-session-handler einen
    // throw kriegt + zur HTTP 500 mapped (transient — Provider/Stripe
    // soll retried werden statt silent-success-mit-leerer-URL).
    const stripe = buildStripe();
    spyOn(stripe.checkout.sessions, "create").mockRejectedValue(
      new Error("Stripe API: Internal server error"),
    );

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    await expect(
      checkout(stubCtx, {
        priceId: "p",
        tenantId: "t",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      }),
    ).rejects.toThrow(/Internal server error/);
  });
});

// =============================================================================
// createPortalSession
// =============================================================================

describe("createStripePortalSession", () => {
  test("ruft stripe.billingPortal.sessions.create mit customer + return_url", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.billingPortal.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://billing.stripe.com/p/session/test" } as any);

    const portal = createStripePortalSession(ctxRuntime(stripe));
    const result = await portal(stubCtx, {
      providerCustomerId: "cus_001",
      returnUrl: "https://example.com/return",
    });

    expect(result).toEqual({ url: "https://billing.stripe.com/p/session/test" });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      customer: "cus_001",
      return_url: "https://example.com/return",
    });
  });
});

// =============================================================================
// cancelSubscription
// =============================================================================

describe("createStripeCancelSubscription", () => {
  test("ruft stripe.subscriptions.cancel mit subscription-id", async () => {
    const stripe = buildStripe();
    const cancelMock = spyOn(stripe.subscriptions, "cancel")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ id: "sub_001", status: "canceled" } as any);

    const cancel = createStripeCancelSubscription(ctxRuntime(stripe));
    await cancel(stubCtx, "sub_001");

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("sub_001");
  });
});
