// Unit-Tests für die Stripe-Plugin-Methoden (createCheckoutSession,
// createPortalSession, cancelSubscription). Stripe-SDK-calls werden via
// vi.spyOn gemockt — wir testen unsere Mapping-Logik (Argumente die wir
// an Stripe schicken + Antwort-Parsing), NICHT Stripe selbst.

import type { HandlerContext } from "@kumiko/framework/engine";
import Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePortalSession,
} from "../plugin-methods";

const TEST_API_KEY = "sk_test_dummy";

function buildStripe(): Stripe {
  return new Stripe(TEST_API_KEY, { apiVersion: "2026-04-22.dahlia" });
}

const stubCtx = {} as HandlerContext;

// =============================================================================
// createCheckoutSession
// =============================================================================

describe("createStripeCheckoutSession", () => {
  test("ruft stripe.checkout.sessions.create mit mode=subscription + tenant-metadata", async () => {
    const stripe = buildStripe();
    const createMock = vi
      .spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/test" } as any);

    const checkout = createStripeCheckoutSession(stripe);
    const result = await checkout(stubCtx, {
      priceId: "price_pro_monthly",
      tenantId: "tenant-001",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/test" });
    expect(createMock).toHaveBeenCalledExactlyOnceWith({
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

  test("passes existing customer-id wenn gesetzt (Plan-Wechsel-Flow)", async () => {
    const stripe = buildStripe();
    const createMock = vi
      .spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://x" } as any);

    const checkout = createStripeCheckoutSession(stripe);
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

  test("throws wenn Stripe keine url returnt (defensive — sollte nie passieren bei mode=subscription)", async () => {
    const stripe = buildStripe();
    vi.spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: SDK-Drift-Test
      .mockResolvedValue({ url: null } as any);

    const checkout = createStripeCheckoutSession(stripe);
    await expect(
      checkout(stubCtx, {
        priceId: "p",
        tenantId: "t",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      }),
    ).rejects.toThrow(/returned no url/);
  });
});

// =============================================================================
// createPortalSession
// =============================================================================

describe("createStripePortalSession", () => {
  test("ruft stripe.billingPortal.sessions.create mit customer + return_url", async () => {
    const stripe = buildStripe();
    const createMock = vi
      .spyOn(stripe.billingPortal.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://billing.stripe.com/p/session/test" } as any);

    const portal = createStripePortalSession(stripe);
    const result = await portal(stubCtx, {
      providerCustomerId: "cus_001",
      returnUrl: "https://example.com/return",
    });

    expect(result).toEqual({ url: "https://billing.stripe.com/p/session/test" });
    expect(createMock).toHaveBeenCalledExactlyOnceWith({
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
    const cancelMock = vi
      .spyOn(stripe.subscriptions, "cancel")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ id: "sub_001", status: "canceled" } as any);

    const cancel = createStripeCancelSubscription(stripe);
    await cancel(stubCtx, "sub_001");

    expect(cancelMock).toHaveBeenCalledExactlyOnceWith("sub_001");
  });
});
