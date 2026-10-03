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

import { describe, expect, mock, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { SubscriptionCancelTimings } from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  FeatureDisabledError,
  UnprocessableError,
} from "@cosmicdrift/kumiko-framework/errors";
import Stripe from "stripe";
import { SUBSCRIPTION_STRIPE_FEATURE } from "../constants.js";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePlanSwitchSession,
  createStripePortalSession,
  createStripePriceCache,
  createStripeRetrievePrices,
  createStripeRetrieveSubscription,
} from "../plugin-methods.js";
import type { StripeCtxRuntime } from "../runtime.js";

const TEST_API_KEY = "sk_test_dummy";

function buildStripe(): Stripe {
  return new Stripe(TEST_API_KEY);
}

/** Test-runtime: gibt den gespyten Client zurück + ein billing-live-Gate
 *  das (default) durchlässt. */
function ctxRuntime(stripe: Stripe, billingLive = true): StripeCtxRuntime {
  return {
    clientForCtx: async () => stripe,
    assertBillingLive: async (_ctx, handlerName = "create-checkout-session") => {
      if (!billingLive) {
        throw new FeatureDisabledError(SUBSCRIPTION_STRIPE_FEATURE, handlerName);
      }
    },
    isBillingEnabled: async () => billingLive,
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
      submit_type: "pay",
      // Drift-Pin: metadata.tenantId LANDET auf der subscription, NICHT
      // auf der checkout-session direkt — sonst kann verifyAndParse-
      // Webhook den tenant beim subsequent webhook nicht resolven.
      subscription_data: {
        metadata: { tenantId: "tenant-001" },
      },
    });
  });

  async function createdParams(
    options: Partial<Parameters<ReturnType<typeof createStripeCheckoutSession>>[1]>,
  ) {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://x" } as any);
    await createStripeCheckoutSession(ctxRuntime(stripe))(stubCtx, {
      priceId: "price_x",
      tenantId: "tenant-1",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
      ...options,
    });
    return createMock.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams; // @cast-boundary test-mock
  }

  test("maps app locale: region falls back to language, unknown → auto, none → omitted", async () => {
    expect((await createdParams({ locale: "de-AT" })).locale).toBe("de");
    expect((await createdParams({ locale: "en-GB" })).locale).toBe("en-GB");
    expect((await createdParams({ locale: "xx" })).locale).toBe("auto");
    expect(await createdParams({})).not.toHaveProperty("locale");
  });

  test("submitMessage lands in custom_text.submit.message, capped at 1200 chars", async () => {
    expect(
      (await createdParams({ submitMessage: "Zahlungspflichtig bestellen" })).custom_text,
    ).toEqual({
      submit: { message: "Zahlungspflichtig bestellen" },
    });
    const long = await createdParams({ submitMessage: "a".repeat(1500) });
    expect(long.custom_text?.submit).toEqual({ message: "a".repeat(1200) });
    expect(await createdParams({})).not.toHaveProperty("custom_text");
  });

  test("consentId rides next to tenantId on subscription_data (subscription) / payment_intent_data (payment)", async () => {
    const subscription = await createdParams({ consentId: "consent-1" });
    expect(subscription.submit_type).toBe("pay");
    expect(subscription.subscription_data?.metadata).toEqual({
      tenantId: "tenant-1",
      consentId: "consent-1",
    });
    const payment = await createdParams({ consentId: "consent-1", mode: "payment" });
    expect(payment.submit_type).toBe("pay");
    expect(payment.payment_intent_data?.metadata).toEqual({
      tenantId: "tenant-1",
      consentId: "consent-1",
    });
    expect(payment).not.toHaveProperty("subscription_data");
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
      submit_type: "pay",
      // Drift-Pin: payment-mode carries tenantId via payment_intent_data,
      // NOT subscription_data — Stripe rejects subscription_data outside
      // subscription-mode.
      payment_intent_data: {
        metadata: { tenantId: "tenant-003" },
      },
      // Default-on: without the runtime option, mode:"payment" gets a
      // Stripe invoice.
      invoice_creation: { enabled: true },
      // Guest checkouts would leave the webhook without a customer id.
      customer_creation: "always",
    });
  });

  test("mode='payment' + paymentInvoiceCreation:false: invoice_creation.enabled is false", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/topup" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe), {
      paymentInvoiceCreation: false,
    });
    await checkout(stubCtx, {
      priceId: "price_credits_topup",
      tenantId: "tenant-003",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      mode: "payment",
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_creation: { enabled: false } }),
    );
  });

  test("mode='subscription': NIE invoice_creation — Stripe rejects es außerhalb payment-mode", async () => {
    const stripe = buildStripe();
    const createMock = spyOn(stripe.checkout.sessions, "create")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ url: "https://x" } as any);

    const checkout = createStripeCheckoutSession(ctxRuntime(stripe));
    await checkout(stubCtx, {
      priceId: "price_x",
      tenantId: "tenant-005",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
      mode: "subscription",
    });

    const callArgs = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("invoice_creation");
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

  describe("stored customer unknown to Stripe", () => {
    const baseOptions = {
      priceId: "price_x",
      tenantId: "tenant-stale",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
    };

    function unknownCustomerError(param: string): Stripe.errors.StripeInvalidRequestError {
      return new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "resource_missing",
        param,
        message: "No such customer: 'cus_stale'",
      });
    }

    test("subscription-mode: retries once without customer and returns the url", async () => {
      const stripe = buildStripe();
      const createMock = spyOn(stripe.checkout.sessions, "create")
        .mockRejectedValueOnce(unknownCustomerError("customer"))
        // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
        .mockResolvedValueOnce({ url: "https://checkout.stripe.com/c/pay/fresh" } as any);

      const result = await createStripeCheckoutSession(ctxRuntime(stripe))(stubCtx, {
        ...baseOptions,
        providerCustomerId: "cus_stale",
      });

      expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/fresh" });
      expect(createMock).toHaveBeenCalledTimes(2);
      expect(createMock.mock.calls[0]?.[0]).toHaveProperty("customer", "cus_stale");
      expect(createMock.mock.calls[1]?.[0]).not.toHaveProperty("customer");
    });

    test("payment-mode: retry creates a customer via customer_creation=always", async () => {
      const stripe = buildStripe();
      const createMock = spyOn(stripe.checkout.sessions, "create")
        .mockRejectedValueOnce(unknownCustomerError("customer"))
        // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
        .mockResolvedValueOnce({ url: "https://x/fresh" } as any);

      await createStripeCheckoutSession(ctxRuntime(stripe))(stubCtx, {
        ...baseOptions,
        mode: "payment",
        providerCustomerId: "cus_stale",
      });

      expect(createMock).toHaveBeenCalledTimes(2);
      const retryParams = createMock.mock.calls[1]?.[0];
      expect(retryParams).not.toHaveProperty("customer");
      expect(retryParams).toHaveProperty("customer_creation", "always");
    });

    test("resource_missing on another param is rethrown without retry", async () => {
      const stripe = buildStripe();
      const createMock = spyOn(stripe.checkout.sessions, "create").mockRejectedValue(
        unknownCustomerError("line_items[0][price]"),
      );

      await expect(
        createStripeCheckoutSession(ctxRuntime(stripe))(stubCtx, {
          ...baseOptions,
          providerCustomerId: "cus_stale",
        }),
      ).rejects.toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    test("without providerCustomerId the error is rethrown without retry", async () => {
      const stripe = buildStripe();
      const createMock = spyOn(stripe.checkout.sessions, "create").mockRejectedValue(
        unknownCustomerError("customer"),
      );

      await expect(
        createStripeCheckoutSession(ctxRuntime(stripe))(stubCtx, baseOptions),
      ).rejects.toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
      expect(createMock).toHaveBeenCalledTimes(1);
    });
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
  test("when=period-end: stripe.subscriptions.update with cancel_at_period_end, no cancel", async () => {
    const stripe = buildStripe();
    const updateMock = spyOn(stripe.subscriptions, "update")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ id: "sub_001" } as any);
    const cancelMock = spyOn(stripe.subscriptions, "cancel")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ id: "sub_001" } as any);

    await createStripeCancelSubscription(ctxRuntime(stripe))(stubCtx, {
      providerSubscriptionId: "sub_001",
      when: SubscriptionCancelTimings.periodEnd,
    });

    expect(updateMock).toHaveBeenCalledWith("sub_001", { cancel_at_period_end: true });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  test("when=immediately: ruft stripe.subscriptions.cancel mit subscription-id", async () => {
    const stripe = buildStripe();
    const cancelMock = spyOn(stripe.subscriptions, "cancel")
      // biome-ignore lint/suspicious/noExplicitAny: Stripe-SDK-typed mock-return
      .mockResolvedValue({ id: "sub_001", status: "canceled" } as any);

    const cancel = createStripeCancelSubscription(ctxRuntime(stripe));
    await cancel(stubCtx, {
      providerSubscriptionId: "sub_001",
      when: SubscriptionCancelTimings.immediately,
    });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("sub_001");
  });
});

// =============================================================================
// retrievePrices + the price cache — each test constructs its own cache
// instances (createStripePriceCache()/new Map() for the portal-configuration
// cache) rather than sharing module state, mirroring how feature.ts
// constructs one cache pair per factory mount.
// =============================================================================

// biome-ignore lint/suspicious/noExplicitAny: minimal Stripe.Price fixture, cast at the mock boundary
function stripePrice(overrides: Record<string, unknown> = {}): any {
  return {
    id: "price_pro",
    unit_amount: 999,
    currency: "usd",
    recurring: { interval: "month", interval_count: 1 },
    active: true,
    metadata: {},
    product: "prod_pro",
    ...overrides,
  };
}

describe("createStripeRetrievePrices", () => {
  test("maps Stripe prices to ProviderPrice", async () => {
    const stripe = buildStripe();
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({ id })) as never);
    const retrieve = createStripeRetrievePrices(ctxRuntime(stripe), createStripePriceCache());
    const result = await retrieve(stubCtx, ["price_pro"]);
    expect(result).toEqual([
      {
        priceId: "price_pro",
        unitAmount: 999,
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        active: true,
        metadata: {},
      },
    ]);
  });

  test.each(["day", "week", "month", "year"] as const)(
    "passes a known recurring interval %s through",
    async (interval) => {
      const stripe = buildStripe();
      spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
        stripePrice({ id, recurring: { interval, interval_count: 1 } })) as never);
      const retrieve = createStripeRetrievePrices(ctxRuntime(stripe), createStripePriceCache());
      const [result] = await retrieve(stubCtx, ["price_pro"]);
      expect(result?.interval).toBe(interval);
    },
  );

  test("maps an interval unknown to ProviderPrice to null — forward-compat with stripe's open Interval union", async () => {
    const stripe = buildStripe();
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      // stripe >= 22.5 types Recurring.Interval as a forward-compatible union
      // (known literals | string); a future Stripe interval isn't one of
      // KNOWN_RECURRING_INTERVALS and must map to null, not widen ProviderPrice.
      stripePrice({ id, recurring: { interval: "biannual", interval_count: 1 } })) as never);
    const retrieve = createStripeRetrievePrices(ctxRuntime(stripe), createStripePriceCache());
    const [result] = await retrieve(stubCtx, ["price_pro"]);
    expect(result?.interval).toBeNull();
    expect(result?.intervalCount).toBeNull();
  });

  test("warns once per priceId about an unknown interval", async () => {
    const stripe = buildStripe();
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({ id, recurring: { interval: "biannual", interval_count: 1 } })) as never);
    const warn = mock(() => {});
    const ctx = { log: { warn } } as unknown as HandlerContext;
    const retrieve = createStripeRetrievePrices(ctxRuntime(stripe), createStripePriceCache());

    await retrieve(ctx, ["price_pro"]);
    await retrieve(ctx, ["price_pro"]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      priceId: "price_pro",
      interval: "biannual",
    });
  });

  test("a cache-hit skips clientForCtx entirely — no Stripe SDK call fires", async () => {
    const stripe = buildStripe();
    const retrieveMock = spyOn(stripe.prices, "retrieve");
    let clientForCtxCalls = 0;
    const runtime: StripeCtxRuntime = {
      ...ctxRuntime(stripe),
      clientForCtx: async () => {
        clientForCtxCalls++;
        return stripe;
      },
    };
    const cache = createStripePriceCache();
    cache.set("price_cached", stripePrice({ id: "price_cached" }));

    const result = await createStripeRetrievePrices(runtime, cache)(stubCtx, ["price_cached"]);

    expect(result).toEqual([
      {
        priceId: "price_cached",
        unitAmount: 999,
        currency: "usd",
        interval: "month",
        intervalCount: 1,
        active: true,
        metadata: {},
      },
    ]);
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(clientForCtxCalls).toBe(0);
  });

  test("a cache entry expires after ttlMs, per an injected clock", async () => {
    const stripe = buildStripe();
    const retrieveMock = spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({ id })) as never);
    let now = 0;
    const cache = createStripePriceCache({ ttlMs: 1000, now: () => now });
    const retrieve = createStripeRetrievePrices(ctxRuntime(stripe), cache);

    await retrieve(stubCtx, ["price_ttl"]);
    now = 500;
    await retrieve(stubCtx, ["price_ttl"]);
    expect(retrieveMock).toHaveBeenCalledTimes(1);

    now = 1500;
    await retrieve(stubCtx, ["price_ttl"]);
    expect(retrieveMock).toHaveBeenCalledTimes(2);
  });

  test("a failed lookup is excluded from the result and not cached — retried on the next call", async () => {
    const stripe = buildStripe();
    const retrieveMock = spyOn(stripe.prices, "retrieve").mockRejectedValueOnce(
      new Error("No such price"),
    );
    const cache = createStripePriceCache();
    const retrieve = createStripeRetrievePrices(ctxRuntime(stripe), cache);

    expect(await retrieve(stubCtx, ["price_missing"])).toEqual([]);

    retrieveMock.mockResolvedValueOnce(stripePrice({ id: "price_missing" }));
    expect(await retrieve(stubCtx, ["price_missing"])).toHaveLength(1);
    expect(retrieveMock).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// createPlanSwitchSession
// =============================================================================

// biome-ignore lint/suspicious/noExplicitAny: minimal Stripe.Subscription fixture, cast at the mock boundary
function stripeSubscription(overrides: Record<string, unknown> = {}): any {
  return {
    id: "sub_switch_001",
    customer: "cus_switch_001",
    items: {
      data: [{ id: "si_001", price: stripePrice({ id: "price_switch_current" }), quantity: 1 }],
    },
    ...overrides,
  };
}

describe("createStripePlanSwitchSession", () => {
  test("builds the subscription_update_confirm flow_data payload and creates a portal configuration", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: id === "price_switch_current" ? "prod_switch_a" : "prod_switch_b",
      })) as never);
    spyOn(stripe.billingPortal.configurations, "list").mockResolvedValue({ data: [] } as never);
    const createConfigMock = spyOn(stripe.billingPortal.configurations, "create").mockResolvedValue(
      { id: "bpc_switch_new" } as never,
    );
    const createSessionMock = spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({
      url: "https://billing.stripe.com/p/session/switch",
    } as never);

    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    const result = await planSwitch(stubCtx, {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_target",
      allowedPriceIds: ["price_switch_current", "price_switch_target"],
      returnUrl: "https://example.com/return",
    });

    expect(result).toEqual({ url: "https://billing.stripe.com/p/session/switch" });
    expect(createConfigMock).toHaveBeenCalledWith({
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          products: [
            { product: "prod_switch_a", prices: ["price_switch_current"] },
            { product: "prod_switch_b", prices: ["price_switch_target"] },
          ],
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
      metadata: { kumikoPlanSwitch: expect.any(String) },
    });
    expect(createSessionMock).toHaveBeenCalledWith({
      customer: "cus_switch_001",
      configuration: "bpc_switch_new",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: "sub_switch_001",
          items: [{ id: "si_001", price: "price_switch_target", quantity: 1 }],
        },
        after_completion: {
          type: "redirect",
          redirect: { return_url: "https://example.com/return" },
        },
      },
    });
  });

  test("a second call for the same price set reuses the in-process configuration cache", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: id === "price_switch_current" ? "prod_switch_c" : "prod_switch_d",
      })) as never);
    const listMock = spyOn(stripe.billingPortal.configurations, "list").mockResolvedValue({
      data: [],
    } as never);
    const createConfigMock = spyOn(stripe.billingPortal.configurations, "create").mockResolvedValue(
      { id: "bpc_switch_reused" } as never,
    );
    spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({
      url: "https://billing.stripe.com/p/session/switch-reuse",
    } as never);

    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    const options = {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_reuse_target",
      allowedPriceIds: ["price_switch_current", "price_switch_reuse_target"],
      returnUrl: "https://example.com/return",
    };
    await planSwitch(stubCtx, options);
    await planSwitch(stubCtx, options);

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(createConfigMock).toHaveBeenCalledTimes(1);
  });

  test("list() finding a configuration with a matching metadata hash skips create() entirely", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: id === "price_switch_current" ? "prod_switch_e" : "prod_switch_f",
      })) as never);
    // Content-addressed hash: same algorithm as priceSetHash() in
    // plugin-methods.ts (not exported), computed here so the mocked list()
    // response can carry a metadata value the code will actually match on.
    const productPricePairs = [
      "prod_switch_e:price_switch_current",
      "prod_switch_f:price_switch_list_target",
    ].sort();
    const matchingHash = createHash("sha256")
      .update(productPricePairs.join(","))
      .digest("hex")
      .slice(0, 16);
    const listMock = spyOn(stripe.billingPortal.configurations, "list").mockResolvedValue({
      data: [{ id: "bpc_switch_existing", metadata: { kumikoPlanSwitch: matchingHash } }],
    } as never);
    const createConfigMock = spyOn(stripe.billingPortal.configurations, "create");
    const createSessionMock = spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({
      url: "https://billing.stripe.com/p/session/switch-existing",
    } as never);

    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    const result = await planSwitch(stubCtx, {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_list_target",
      allowedPriceIds: ["price_switch_current", "price_switch_list_target"],
      returnUrl: "https://example.com/return",
    });

    expect(result).toEqual({ url: "https://billing.stripe.com/p/session/switch-existing" });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(createConfigMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: "bpc_switch_existing" }),
    );
  });

  test("a sessions.create failure evicts the cached configuration id so the next call re-resolves it", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: id === "price_switch_current" ? "prod_switch_g" : "prod_switch_h",
      })) as never);
    const listMock = spyOn(stripe.billingPortal.configurations, "list").mockResolvedValue({
      data: [],
    } as never);
    const createConfigMock = spyOn(stripe.billingPortal.configurations, "create").mockResolvedValue(
      { id: "bpc_switch_evict" } as never,
    );
    const createSessionMock = spyOn(stripe.billingPortal.sessions, "create")
      .mockRejectedValueOnce(new Error("Stripe: no such configuration"))
      .mockResolvedValueOnce({
        url: "https://billing.stripe.com/p/session/switch-recovered",
      } as never);

    const sharedCache = new Map<string, string>();
    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      sharedCache,
    );
    const options = {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_evict_target",
      allowedPriceIds: ["price_switch_current", "price_switch_evict_target"],
      returnUrl: "https://example.com/return",
    };

    await expect(planSwitch(stubCtx, options)).rejects.toThrow("Stripe: no such configuration");
    expect(sharedCache.size).toBe(0);

    const result = await planSwitch(stubCtx, options);
    expect(result).toEqual({ url: "https://billing.stripe.com/p/session/switch-recovered" });
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(createConfigMock).toHaveBeenCalledTimes(2);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  test("two allowed prices sharing a product+interval throw UnprocessableError('plan_tiers_share_product') before any Stripe portal call", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: "prod_switch_collision",
        recurring: { interval: "month", interval_count: 1 },
      })) as never);
    const listMock = spyOn(stripe.billingPortal.configurations, "list");

    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    const promise = planSwitch(stubCtx, {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_collision_b",
      allowedPriceIds: ["price_switch_collision_a", "price_switch_collision_b"],
      returnUrl: "https://example.com/return",
    });
    await expect(promise).rejects.toThrow(/every plan tier needs its own Stripe product/);
    await expect(promise).rejects.toBeInstanceOf(UnprocessableError);
    await expect(promise).rejects.toMatchObject({
      httpStatus: 422,
      i18nKey: "billing-foundation.errors.planTiersShareProduct",
      details: { reason: "plan_tiers_share_product" },
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  test("an allowed price whose prices.retrieve fails throws UnprocessableError('price_unavailable') before any portal configuration is listed or created", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) => {
      if (id === "price_switch_flaky") throw new Error("stripe 503");
      return stripePrice({ id, product: "prod_switch_ok" });
    }) as never);
    const listMock = spyOn(stripe.billingPortal.configurations, "list");
    const createConfigMock = spyOn(stripe.billingPortal.configurations, "create");

    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    const promise = planSwitch(stubCtx, {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_flaky",
      allowedPriceIds: ["price_switch_current", "price_switch_flaky"],
      returnUrl: "https://example.com/return",
    });
    await expect(promise).rejects.toBeInstanceOf(UnprocessableError);
    await expect(promise).rejects.toMatchObject({
      httpStatus: 422,
      i18nKey: "billing-foundation.errors.priceUnavailable",
      details: { reason: "price_unavailable" },
    });
    expect(listMock).not.toHaveBeenCalled();
    expect(createConfigMock).not.toHaveBeenCalled();
  });

  test("a StripeInvalidRequestError from configurations.create() concerning subscription_update products becomes UnprocessableError('plan_tiers_share_product')", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: id === "price_switch_current" ? "prod_switch_i" : "prod_switch_j",
      })) as never);
    spyOn(stripe.billingPortal.configurations, "list").mockResolvedValue({ data: [] } as never);
    spyOn(stripe.billingPortal.configurations, "create").mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "Invalid subscription_update.products",
        param: "features[subscription_update][products][1][prices]",
      }),
    );
    const createSessionMock = spyOn(stripe.billingPortal.sessions, "create");

    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    const promise = planSwitch(stubCtx, {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_config_target",
      allowedPriceIds: ["price_switch_current", "price_switch_config_target"],
      returnUrl: "https://example.com/return",
    });
    await expect(promise).rejects.toBeInstanceOf(UnprocessableError);
    await expect(promise).rejects.toMatchObject({
      i18nKey: "billing-foundation.errors.planTiersShareProduct",
      details: { reason: "plan_tiers_share_product" },
    });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  test("a StripeInvalidRequestError from sessions.create() for the flow items is NOT mapped to plan_tiers_share_product and still evicts the cached configuration", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    spyOn(stripe.prices, "retrieve").mockImplementation((async (id: string) =>
      stripePrice({
        id,
        product: id === "price_switch_current" ? "prod_switch_k" : "prod_switch_l",
      })) as never);
    spyOn(stripe.billingPortal.configurations, "list").mockResolvedValue({ data: [] } as never);
    spyOn(stripe.billingPortal.configurations, "create").mockResolvedValue({
      id: "bpc_switch_session_err",
    } as never);
    spyOn(stripe.billingPortal.sessions, "create").mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "The price is not active",
        param: "flow_data.subscription_update_confirm.items[0].price",
      }),
    );

    const sharedCache = new Map<string, string>();
    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      sharedCache,
    );
    const promise = planSwitch(stubCtx, {
      providerSubscriptionId: "sub_switch_001",
      targetPriceId: "price_switch_session_target",
      allowedPriceIds: ["price_switch_current", "price_switch_session_target"],
      returnUrl: "https://example.com/return",
    });
    await expect(promise).rejects.toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
    await expect(promise).rejects.not.toBeInstanceOf(UnprocessableError);
    expect(sharedCache.size).toBe(0);
  });

  test("multi-item subscriptions are rejected", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      stripeSubscription({
        items: {
          data: [
            { id: "si_001", price: stripePrice({ id: "price_a" }), quantity: 1 },
            { id: "si_002", price: stripePrice({ id: "price_b" }), quantity: 1 },
          ],
        },
      }),
    );
    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    await expect(
      planSwitch(stubCtx, {
        providerSubscriptionId: "sub_switch_001",
        targetPriceId: "price_c",
        allowedPriceIds: ["price_a", "price_b", "price_c"],
        returnUrl: "https://example.com/return",
      }),
    ).rejects.toThrow(/must have exactly one line item/);
  });

  test("switching to the currently-active price throws ConflictError('alreadyOnPlan')", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      stripeSubscription({
        items: {
          data: [{ id: "si_001", price: stripePrice({ id: "price_already" }), quantity: 1 }],
        },
      }),
    );
    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    await expect(
      planSwitch(stubCtx, {
        providerSubscriptionId: "sub_switch_001",
        targetPriceId: "price_already",
        allowedPriceIds: ["price_already"],
        returnUrl: "https://example.com/return",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("a target price outside allowedPriceIds throws", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription());
    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    await expect(
      planSwitch(stubCtx, {
        providerSubscriptionId: "sub_switch_001",
        targetPriceId: "price_not_in_catalog",
        allowedPriceIds: ["price_switch_current"],
        returnUrl: "https://example.com/return",
      }),
    ).rejects.toThrow(/not one of the catalog's allowed prices/);
  });

  test("#104-Gate: throws FeatureDisabledError when billing-live is off", async () => {
    const stripe = buildStripe();
    const retrieveMock = spyOn(stripe.subscriptions, "retrieve");
    const planSwitch = createStripePlanSwitchSession(
      ctxRuntime(stripe, false),
      createStripePriceCache(),
      new Map<string, string>(),
    );
    await expect(
      planSwitch(stubCtx, {
        providerSubscriptionId: "sub_switch_001",
        targetPriceId: "price_switch_target",
        allowedPriceIds: ["price_switch_current", "price_switch_target"],
        returnUrl: "https://example.com/return",
      }),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
    expect(retrieveMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// retrieveSubscription — sync-subscriptions backfill, same status/tier/
// period-end/cancel_at mapping as verify-webhook.ts's mapStripeSubscriptionState.
// =============================================================================

const PRICE_TO_TIER = { price_retrieve_pro: "pro" };

function stripeSubscriptionForRetrieve(overrides: Record<string, unknown> = {}) {
  return stripeSubscription({
    status: "active",
    items: {
      data: [
        {
          id: "si_001",
          price: stripePrice({ id: "price_retrieve_pro" }),
          quantity: 1,
          current_period_end: 1_800_000_000,
        },
      ],
    },
    cancel_at: null,
    cancel_at_period_end: false,
    ...overrides,
  });
}

describe("createStripeRetrieveSubscription", () => {
  test("maps a live subscription to a ProviderSubscriptionSnapshot", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscriptionForRetrieve());
    const retrieve = createStripeRetrieveSubscription(ctxRuntime(stripe), {
      priceToTier: PRICE_TO_TIER,
    });

    const result = await retrieve(stubCtx, "sub_switch_001");

    expect(result).toEqual({
      providerCustomerId: "cus_switch_001",
      providerSubscriptionId: "sub_switch_001",
      status: "active",
      tier: "pro",
      currentPeriodEnd: "2027-01-15T08:00:00Z",
      cancelAt: null,
    });
  });

  test("a resource_missing StripeInvalidRequestError resolves to null instead of throwing", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "No such subscription: 'sub_gone'",
        code: "resource_missing",
      }),
    );
    const retrieve = createStripeRetrieveSubscription(ctxRuntime(stripe), {
      priceToTier: PRICE_TO_TIER,
    });

    expect(await retrieve(stubCtx, "sub_gone")).toBeNull();
  });

  test("an unmapped priceId resolves to null (same as verify-webhook's silent-drop)", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      stripeSubscriptionForRetrieve({
        items: {
          data: [
            {
              id: "si_001",
              price: stripePrice({ id: "price_unmapped" }),
              quantity: 1,
              current_period_end: 1_800_000_000,
            },
          ],
        },
      }),
    );
    const retrieve = createStripeRetrieveSubscription(ctxRuntime(stripe), {
      priceToTier: PRICE_TO_TIER,
    });

    expect(await retrieve(stubCtx, "sub_switch_001")).toBeNull();
  });

  test("a non-resource_missing Stripe error rethrows", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "rate limited",
        code: "rate_limit",
      }),
    );
    const retrieve = createStripeRetrieveSubscription(ctxRuntime(stripe), {
      priceToTier: PRICE_TO_TIER,
    });

    await expect(retrieve(stubCtx, "sub_switch_001")).rejects.toBeInstanceOf(
      Stripe.errors.StripeInvalidRequestError,
    );
  });

  test("a scheduled cancel_at is mapped through", async () => {
    const stripe = buildStripe();
    spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(
      stripeSubscriptionForRetrieve({ cancel_at: 1_850_000_000 }),
    );
    const retrieve = createStripeRetrieveSubscription(ctxRuntime(stripe), {
      priceToTier: PRICE_TO_TIER,
    });

    const result = await retrieve(stubCtx, "sub_switch_001");
    expect(result?.cancelAt).toBe("2028-08-16T00:53:20Z");
  });
});
