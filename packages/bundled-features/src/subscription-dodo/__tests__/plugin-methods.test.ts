import { describe, expect, test } from "bun:test";
import { FeatureDisabledError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { SubscriptionCancelTimings } from "../../billing-foundation/index.ts";
import {
  createDodoApplyPlanSwitch,
  createDodoCancelSubscription,
  createDodoCheckoutSession,
  createDodoPortalSession,
  createDodoPreviewPlanSwitch,
  createDodoPriceCache,
  createDodoResumeSubscription,
  createDodoRetrievePrices,
  createDodoRetrieveSubscription,
} from "../plugin-methods.ts";
import {
  createSendMock,
  type MockReply,
  makeRuntimes,
  type RecordedCall,
  stubCtx,
  subscriptionData,
  TEST_API_KEY,
} from "./dodo-test-kit.ts";

const TEST_BASE = "https://test.dodopayments.com";
const LIVE_BASE = "https://live.dodopayments.com";

function setup(respond?: (call: RecordedCall) => MockReply) {
  const mock = createSendMock(respond);
  return { ...mock, runtime: makeRuntimes(mock.send).ctx };
}

describe("createCheckoutSession", () => {
  const options = {
    priceId: "pdt_pro",
    tenantId: "tenant-dodo",
    successUrl: "https://app.example.com/ok",
    cancelUrl: "https://app.example.com/cancel",
  };
  const reply = () => ({
    body: { session_id: "cks_1", checkout_url: "https://checkout.dodo/cks_1" },
  });

  test("posts the cart with tenant metadata, bearer auth and the test host", async () => {
    const { runtime, calls } = setup(reply);
    const result = await createDodoCheckoutSession(runtime)(stubCtx(), options);
    expect(result).toEqual({ url: "https://checkout.dodo/cks_1" });
    expect(calls).toEqual([
      {
        url: `${TEST_BASE}/checkouts`,
        method: "POST",
        authorization: `Bearer ${TEST_API_KEY}`,
        body: {
          product_cart: [{ product_id: "pdt_pro", quantity: 1 }],
          return_url: "https://app.example.com/ok",
          cancel_url: "https://app.example.com/cancel",
          metadata: { tenantId: "tenant-dodo" },
        },
      },
    ]);
  });

  test("uses the live host when the environment is live", async () => {
    const { runtime, calls } = setup(reply);
    await createDodoCheckoutSession(runtime)(stubCtx({ environment: "live" }), options);
    expect(calls[0]?.url).toBe(`${LIVE_BASE}/checkouts`);
  });

  test("forwards customer, consentId and the language", async () => {
    const { runtime, calls } = setup(reply);
    await createDodoCheckoutSession(runtime)(stubCtx(), {
      ...options,
      providerCustomerId: "cus_1",
      consentId: "consent-1",
      locale: "de-DE",
    });
    expect(calls[0]?.body).toMatchObject({
      customer: { customer_id: "cus_1" },
      metadata: { tenantId: "tenant-dodo", consentId: "consent-1" },
      customization: { force_language: "de" },
    });
  });

  test("is closed while billingLive is off and makes no request", async () => {
    const { runtime, calls } = setup(reply);
    await expect(
      createDodoCheckoutSession(runtime)(stubCtx({ billingLive: false }), options),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
    expect(calls).toHaveLength(0);
  });

  test("throws when no api key is configured anywhere", async () => {
    const mock = createSendMock(reply);
    const runtime = makeRuntimes(mock.send, {}).ctx;
    await expect(createDodoCheckoutSession(runtime)(stubCtx(), options)).rejects.toBeInstanceOf(
      UnconfiguredError,
    );
  });

  test("a non-2xx answer throws with the status and never the key or body", async () => {
    const { runtime } = setup(() => ({ status: 401, body: { secret: "do-not-leak" } }));
    const error = await createDodoCheckoutSession(runtime)(stubCtx(), options).catch(
      (e: unknown) => e,
    );
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("401");
    expect(message).not.toContain(TEST_API_KEY);
    expect(message).not.toContain("do-not-leak");
  });
});

describe("portal, cancel, resume", () => {
  test("portal session posts with the encoded customer id and return_url query", async () => {
    const { runtime, calls } = setup(() => ({ body: { link: "https://portal.dodo/x" } }));
    const result = await createDodoPortalSession(runtime)(stubCtx(), {
      providerCustomerId: "cus/1",
      returnUrl: "https://app.example.com/back?a=1",
    });
    expect(result).toEqual({ url: "https://portal.dodo/x" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${TEST_BASE}/customers/cus%2F1/customer-portal/session?return_url=https%3A%2F%2Fapp.example.com%2Fback%3Fa%3D1`,
    });
  });

  test("cancel at period end schedules the cancellation", async () => {
    const { runtime, calls } = setup();
    await createDodoCancelSubscription(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      when: SubscriptionCancelTimings.periodEnd,
    });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: `${TEST_BASE}/subscriptions/sub_1`,
      body: { cancel_at_next_billing_date: true },
    });
  });

  test("cancel immediately sets the status", async () => {
    const { runtime, calls } = setup();
    await createDodoCancelSubscription(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      when: SubscriptionCancelTimings.immediately,
    });
    expect(calls[0]?.body).toEqual({ status: "cancelled" });
  });

  test("resume takes the scheduled cancellation back", async () => {
    const { runtime, calls } = setup();
    await createDodoResumeSubscription(runtime)(stubCtx(), { providerSubscriptionId: "sub_1" });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      body: { cancel_at_next_billing_date: false },
    });
  });
});

describe("retrievePrices", () => {
  const products: Record<string, unknown> = {
    pdt_month: {
      product_id: "pdt_month",
      price: {
        type: "recurring_price",
        price: 1990,
        currency: "EUR",
        payment_frequency_interval: "Month",
        payment_frequency_count: 1,
      },
    },
    pdt_once: {
      product_id: "pdt_once",
      price: { type: "one_time_price", price: 500, currency: "EUR" },
    },
    pdt_usage: { product_id: "pdt_usage", price: { type: "usage_based_price" } },
  };
  const respond = (call: RecordedCall): MockReply => {
    const id = call.url.split("/products/")[1] ?? "";
    return id in products ? { body: products[id] } : { status: 404 };
  };

  test("maps recurring, one-off and skips usage-based products", async () => {
    const { runtime, calls } = setup(respond);
    const prices = await createDodoRetrievePrices(runtime, createDodoPriceCache())(stubCtx(), [
      "pdt_month",
      "pdt_once",
      "pdt_usage",
    ]);
    expect(prices).toEqual([
      {
        priceId: "pdt_month",
        unitAmount: 1990,
        currency: "eur",
        interval: "month",
        intervalCount: 1,
        active: true,
        metadata: {},
      },
      {
        priceId: "pdt_once",
        unitAmount: 500,
        currency: "eur",
        interval: null,
        intervalCount: 1,
        active: true,
        metadata: {},
      },
    ]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
  });

  test("a missing product is absent from the result instead of failing the call", async () => {
    const { runtime } = setup(respond);
    const prices = await createDodoRetrievePrices(runtime, createDodoPriceCache())(stubCtx(), [
      "pdt_month",
      "pdt_gone",
    ]);
    expect(prices.map((p) => p.priceId)).toEqual(["pdt_month"]);
  });

  test("a second call within the TTL is served from the cache, an expired entry is refetched", async () => {
    let nowMs = 0;
    const { runtime, calls } = setup(respond);
    const retrieve = createDodoRetrievePrices(
      runtime,
      createDodoPriceCache({ ttlMs: 1000, now: () => nowMs }),
    );
    await retrieve(stubCtx(), ["pdt_month"]);
    await retrieve(stubCtx(), ["pdt_month"]);
    expect(calls).toHaveLength(1);
    nowMs = 1000;
    await retrieve(stubCtx(), ["pdt_month"]);
    expect(calls).toHaveLength(2);
  });
});

describe("in-app plan switch", () => {
  const previewReplyWithTax = (tax: number | null) => ({
    immediate_charge: {
      summary: {
        total_amount: 667,
        tax,
        currency: "EUR",
        customer_credits: 333,
        customer_credits_currency: "EUR",
      },
      effective_at: "2026-11-01T10:00:00Z",
    },
    new_plan: { product_id: "pdt_pro" },
  });

  test("preview posts the proration body and maps the summary", async () => {
    const { runtime, calls } = setup(() => ({ body: previewReplyWithTax(106) }));
    const preview = await createDodoPreviewPlanSwitch(runtime)(stubCtx(), {
      providerSubscriptionId: "sub/1",
      targetPriceId: "pdt_pro",
    });
    expect(preview).toEqual({
      amountDueNow: 667,
      tax: 106,
      currency: "eur",
      credit: 333,
      effectiveAt: "2026-11-01T10:00:00Z",
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${TEST_BASE}/subscriptions/sub%2F1/change-plan/preview`,
      body: {
        product_id: "pdt_pro",
        quantity: 1,
        proration_billing_mode: "prorated_immediately",
        effective_at: "immediately",
      },
    });
  });

  test("preview keeps a null tax as null", async () => {
    const { runtime } = setup(() => ({ body: previewReplyWithTax(null) }));
    const preview = await createDodoPreviewPlanSwitch(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      targetPriceId: "pdt_pro",
    });
    expect(preview.tax).toBeNull();
  });

  test("apply posts the switch with tenant and consent metadata and keeps the old plan on a failed charge", async () => {
    const { runtime, calls } = setup(() => ({ body: { payment_id: "pay_1", payment_link: null } }));
    await createDodoApplyPlanSwitch(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      targetPriceId: "pdt_pro",
      tenantId: "tenant-dodo",
      consentId: "consent-1",
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${TEST_BASE}/subscriptions/sub_1/change-plan`,
      body: {
        product_id: "pdt_pro",
        quantity: 1,
        proration_billing_mode: "prorated_immediately",
        effective_at: "immediately",
        on_payment_failure: "prevent_change",
        metadata: { tenantId: "tenant-dodo", consentId: "consent-1" },
      },
    });
  });

  test("apply without a consent leaves consentId out of the metadata", async () => {
    const { runtime, calls } = setup();
    await createDodoApplyPlanSwitch(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      targetPriceId: "pdt_pro",
      tenantId: "tenant-dodo",
    });
    expect(calls[0]?.body).toMatchObject({ metadata: { tenantId: "tenant-dodo" } });
  });
});

describe("retrieveSubscription", () => {
  const priceToTier = { pdt_pro: "pro" };

  test("maps the live state like the webhook does", async () => {
    const { runtime, calls } = setup(() => ({
      body: subscriptionData({ cancel_at_next_billing_date: true }),
    }));
    const snapshot = await createDodoRetrieveSubscription(runtime, { priceToTier })(
      stubCtx(),
      "sub_dodo_1",
    );
    expect(snapshot).toEqual({
      providerCustomerId: "cus_dodo_1",
      providerSubscriptionId: "sub_dodo_1",
      status: "active",
      tier: "pro",
      currentPeriodEnd: "2026-12-01T10:00:00Z",
      cancelAt: "2026-12-01T10:00:00Z",
    });
    expect(calls[0]).toMatchObject({ method: "GET", url: `${TEST_BASE}/subscriptions/sub_dodo_1` });
  });

  test("a 404 means the subscription is gone", async () => {
    const { runtime } = setup(() => ({ status: 404 }));
    expect(
      await createDodoRetrieveSubscription(runtime, { priceToTier })(stubCtx(), "sub_gone"),
    ).toBeNull();
  });

  test("other errors propagate", async () => {
    const { runtime } = setup(() => ({ status: 500 }));
    await expect(
      createDodoRetrieveSubscription(runtime, { priceToTier })(stubCtx(), "sub_1"),
    ).rejects.toThrow(/500/);
  });

  test("an unmapped product yields no snapshot", async () => {
    const { runtime } = setup(() => ({ body: subscriptionData({ product_id: "pdt_other" }) }));
    expect(
      await createDodoRetrieveSubscription(runtime, { priceToTier })(stubCtx(), "sub_1"),
    ).toBeNull();
  });
});

describe("isBillingEnabled", () => {
  test("needs billingLive and a key", async () => {
    const mock = createSendMock();
    const withKey = makeRuntimes(mock.send).ctx;
    expect(await withKey.isBillingEnabled(stubCtx({ billingLive: true }))).toBe(true);
    expect(await withKey.isBillingEnabled(stubCtx({ billingLive: false }))).toBe(false);
    const withoutKey = makeRuntimes(mock.send, {}).ctx;
    expect(await withoutKey.isBillingEnabled(stubCtx({ billingLive: true }))).toBe(false);
  });
});
