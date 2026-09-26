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
import { createHash } from "node:crypto";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  FeatureDisabledError,
  UnprocessableError,
} from "@cosmicdrift/kumiko-framework/errors";
import Stripe from "stripe";
import { SUBSCRIPTION_STRIPE_FEATURE } from "../constants";
import {
  createStripeCancelSubscription,
  createStripeCheckoutSession,
  createStripePlanSwitchSession,
  createStripePortalSession,
  createStripePriceCache,
  createStripeRetrievePrices,
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
      // Default-on: without the runtime option, mode:"payment" gets a
      // Stripe invoice.
      invoice_creation: { enabled: true },
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

  test("a StripeInvalidRequestError from sessions.create() concerning subscription_update products becomes UnprocessableError and still evicts the cached configuration", async () => {
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
        message: "subscription_update configuration mismatch",
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
    await expect(promise).rejects.toBeInstanceOf(UnprocessableError);
    await expect(promise).rejects.toMatchObject({
      i18nKey: "billing-foundation.errors.planTiersShareProduct",
    });
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
