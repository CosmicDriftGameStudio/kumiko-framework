import { describe, expect, test } from "bun:test";
import { FeatureDisabledError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { SubscriptionCancelTimings } from "../../billing-foundation/index.ts";
import {
  createPaddleCancelSubscription,
  createPaddleCheckoutSession,
  createPaddlePortalSession,
  createPaddleResumeSubscription,
} from "../checkout-methods.ts";
import {
  createPaddleApplyPlanSwitch,
  createPaddlePreviewPlanSwitch,
  createPaddleRetrieveSubscription,
} from "../plan-switch-methods.ts";
import { createPaddlePriceCache, createPaddleRetrievePrices } from "../price-methods.ts";
import { isValidTenantBinding } from "../tenant-binding.ts";
import {
  createSendMock,
  type MockReply,
  makeRuntimes,
  type RecordedCall,
  stubCtx,
  subscriptionData,
  TEST_API_KEY,
  TEST_BINDING_KEY,
} from "./paddle-test-kit.ts";

const SANDBOX_BASE = "https://sandbox-api.paddle.com";
const LIVE_BASE = "https://api.paddle.com";

function setup(respond?: (call: RecordedCall) => MockReply) {
  const mock = createSendMock(respond);
  return { ...mock, runtime: makeRuntimes(mock.send).ctx };
}

function customDataOf(call: RecordedCall | undefined): Record<string, unknown> {
  const body = call?.body;
  if (typeof body !== "object" || body === null || !("custom_data" in body)) return {};
  const customData = body.custom_data;
  return typeof customData === "object" && customData !== null
    ? Object.fromEntries(Object.entries(customData))
    : {};
}

describe("createCheckoutSession", () => {
  const options = {
    priceId: "pri_pro",
    tenantId: "tenant-paddle",
    successUrl: "https://app.example.com/billing/success?plan=pro",
    cancelUrl: "https://app.example.com/billing/cancel",
  };
  const reply = () => ({
    body: {
      data: {
        id: "txn_1",
        checkout: { url: "https://app.example.com/billing/paddle-checkout?_ptxn=txn_1" },
      },
    },
  });

  test("creates the transaction with bound custom data, bearer auth and the sandbox host", async () => {
    const { runtime, calls } = setup(reply);
    const result = await createPaddleCheckoutSession(runtime)(stubCtx(), options);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toMatchObject({
      url: `${SANDBOX_BASE}/transactions`,
      method: "POST",
      authorization: `Bearer ${TEST_API_KEY}`,
    });
    expect(call?.headers["paddle-version"]).toBe("1");
    expect(call?.headers["content-type"]).toBe("application/json");
    const body = call?.body as {
      items: unknown;
      custom_data: { tenantId: string; tenantBinding: string };
      checkout: unknown;
    };
    expect(body.items).toEqual([{ price_id: "pri_pro", quantity: 1 }]);
    expect(body.checkout).toEqual({ url: "https://app.example.com/billing/paddle-checkout" });
    expect(body.custom_data.tenantId).toBe("tenant-paddle");
    expect(
      isValidTenantBinding(TEST_BINDING_KEY, "tenant-paddle", body.custom_data.tenantBinding),
    ).toBe(true);
    expect(result.url).toBe(
      "https://app.example.com/billing/paddle-checkout?_ptxn=txn_1&success=%2Fbilling%2Fsuccess%3Fplan%3Dpro&cancel=%2Fbilling%2Fcancel",
    );
  });

  test("uses the live host when the environment is live", async () => {
    const { runtime, calls } = setup(reply);
    await createPaddleCheckoutSession(runtime)(stubCtx({ environment: "live" }), options);
    expect(calls[0]?.url).toBe(`${LIVE_BASE}/transactions`);
  });

  test("forwards customer, consentId and the locale", async () => {
    const { runtime, calls } = setup(reply);
    const result = await createPaddleCheckoutSession(runtime)(stubCtx(), {
      ...options,
      providerCustomerId: "ctm_1",
      consentId: "consent-1",
      locale: "de",
    });
    expect(calls[0]?.body).toMatchObject({
      customer_id: "ctm_1",
      custom_data: { tenantId: "tenant-paddle", consentId: "consent-1" },
    });
    expect(new URL(result.url).searchParams.get("locale")).toBe("de");
  });

  test("is closed while billingLive is off and makes no request", async () => {
    const { runtime, calls } = setup(reply);
    await expect(
      createPaddleCheckoutSession(runtime)(stubCtx({ billingLive: false }), options),
    ).rejects.toBeInstanceOf(FeatureDisabledError);
    expect(calls).toHaveLength(0);
  });

  test("throws when no api key is configured anywhere", async () => {
    const mock = createSendMock(reply);
    const runtime = makeRuntimes(mock.send, { tenantBindingKey: TEST_BINDING_KEY }).ctx;
    await expect(createPaddleCheckoutSession(runtime)(stubCtx(), options)).rejects.toBeInstanceOf(
      UnconfiguredError,
    );
  });

  test("throws when no tenant binding key is configured and makes no request", async () => {
    const mock = createSendMock(reply);
    const runtime = makeRuntimes(mock.send, { apiKey: TEST_API_KEY }).ctx;
    await expect(createPaddleCheckoutSession(runtime)(stubCtx(), options)).rejects.toBeInstanceOf(
      UnconfiguredError,
    );
    expect(mock.calls).toHaveLength(0);
  });

  test("a transaction without a checkout url is an error", async () => {
    const { runtime } = setup(() => ({ body: { data: { id: "txn_1", checkout: null } } }));
    await expect(createPaddleCheckoutSession(runtime)(stubCtx(), options)).rejects.toThrow(
      /without a checkout url/,
    );
  });

  test("a non-2xx answer throws with the status and never the key or body", async () => {
    const { runtime } = setup(() => ({ status: 403, body: { leak: "do-not-leak" } }));
    const error = await createPaddleCheckoutSession(runtime)(stubCtx(), options).catch(
      (e: unknown) => e,
    );
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("403");
    expect(message).not.toContain(TEST_API_KEY);
    expect(message).not.toContain("do-not-leak");
  });
});

describe("portal, cancel, resume", () => {
  test("portal session posts with the encoded customer id and returns the overview url", async () => {
    const { runtime, calls } = setup(() => ({
      body: { data: { urls: { general: { overview: "https://portal.paddle.test/x" } } } },
    }));
    const result = await createPaddlePortalSession(runtime)(stubCtx(), {
      providerCustomerId: "ctm/1",
      returnUrl: "https://app.example.com/back",
    });
    expect(result).toEqual({ url: "https://portal.paddle.test/x" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${SANDBOX_BASE}/customers/ctm%2F1/portal-sessions`,
    });
  });

  test("cancel at period end uses next_billing_period", async () => {
    const { runtime, calls } = setup();
    await createPaddleCancelSubscription(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      when: SubscriptionCancelTimings.periodEnd,
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${SANDBOX_BASE}/subscriptions/sub_1/cancel`,
      body: { effective_from: "next_billing_period" },
    });
  });

  test("cancel immediately", async () => {
    const { runtime, calls } = setup();
    await createPaddleCancelSubscription(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      when: SubscriptionCancelTimings.immediately,
    });
    expect(calls[0]?.body).toEqual({ effective_from: "immediately" });
  });

  test("resume clears the scheduled change", async () => {
    const { runtime, calls } = setup();
    await createPaddleResumeSubscription(runtime)(stubCtx(), { providerSubscriptionId: "sub_1" });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: `${SANDBOX_BASE}/subscriptions/sub_1`,
      body: { scheduled_change: null },
    });
  });
});

describe("retrievePrices", () => {
  const priceReply = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    unit_price: { amount: "1990", currency_code: "EUR" },
    billing_cycle: { interval: "month", frequency: 1 },
    status: "active",
    custom_data: null,
    product: { custom_data: null },
    ...overrides,
  });

  test("maps string amounts, cycles and merges product and price custom data", async () => {
    const { runtime, calls } = setup(() => ({
      body: {
        data: [
          priceReply("pri_month"),
          priceReply("pri_once", {
            unit_price: { amount: "500", currency_code: "EUR" },
            billing_cycle: null,
            status: "archived",
            custom_data: { credits: 80 },
            product: { custom_data: { credits: "50", label: "pack" } },
          }),
        ],
      },
    }));
    const prices = await createPaddleRetrievePrices(runtime, createPaddlePriceCache())(stubCtx(), [
      "pri_month",
      "pri_once",
    ]);
    expect(prices).toEqual([
      {
        priceId: "pri_month",
        unitAmount: 1990,
        currency: "eur",
        interval: "month",
        intervalCount: 1,
        active: true,
        metadata: {},
      },
      {
        priceId: "pri_once",
        unitAmount: 500,
        currency: "eur",
        interval: null,
        intervalCount: 1,
        active: false,
        metadata: { credits: "80", label: "pack" },
      },
    ]);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/prices");
    expect(url.searchParams.get("id")).toBe("pri_month,pri_once");
    expect(url.searchParams.get("include")).toBe("product");
    expect(url.searchParams.get("status")).toBe("active,archived");
  });

  test("more than 200 ids are split into batches", async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `pri_${index}`);
    const { runtime, calls } = setup((call) => ({
      body: {
        data: (new URL(call.url).searchParams.get("id") ?? "")
          .split(",")
          .map((id) => priceReply(id)),
      },
    }));
    const prices = await createPaddleRetrievePrices(runtime, createPaddlePriceCache())(
      stubCtx(),
      ids,
    );
    expect(calls).toHaveLength(2);
    expect(prices).toHaveLength(201);
  });

  test("a missing price is absent from the result instead of failing the call", async () => {
    const { runtime } = setup(() => ({ body: { data: [priceReply("pri_month")] } }));
    const prices = await createPaddleRetrievePrices(runtime, createPaddlePriceCache())(stubCtx(), [
      "pri_month",
      "pri_gone",
    ]);
    expect(prices.map((p) => p.priceId)).toEqual(["pri_month"]);
  });

  test("a second call within the TTL is served from the cache, an expired entry is refetched", async () => {
    let nowMs = 0;
    const { runtime, calls } = setup(() => ({ body: { data: [priceReply("pri_month")] } }));
    const retrieve = createPaddleRetrievePrices(
      runtime,
      createPaddlePriceCache({ ttlMs: 1000, now: () => nowMs }),
    );
    await retrieve(stubCtx(), ["pri_month"]);
    await retrieve(stubCtx(), ["pri_month"]);
    expect(calls).toHaveLength(1);
    nowMs = 1000;
    await retrieve(stubCtx(), ["pri_month"]);
    expect(calls).toHaveLength(2);
  });

  test("a failed lookup is not cached", async () => {
    let failing = true;
    const { runtime, calls } = setup(() =>
      failing ? { status: 500 } : { body: { data: [priceReply("pri_month")] } },
    );
    const retrieve = createPaddleRetrievePrices(runtime, createPaddlePriceCache());
    expect(await retrieve(stubCtx(), ["pri_month"])).toEqual([]);
    failing = false;
    expect((await retrieve(stubCtx(), ["pri_month"])).map((p) => p.priceId)).toEqual(["pri_month"]);
    expect(calls).toHaveLength(2);
  });
});

describe("in-app plan switch", () => {
  const previewReply = (withImmediate: boolean) => ({
    data: {
      currency_code: "EUR",
      immediate_transaction: withImmediate
        ? { details: { totals: { grand_total: "667", tax: "106", currency_code: "EUR" } } }
        : null,
      update_summary: { credit: { amount: "333", currency_code: "EUR" } },
    },
  });

  test("preview patches the preview endpoint with the proration body and maps string amounts", async () => {
    const { runtime, calls } = setup(() => ({ body: previewReply(true) }));
    const preview = await createPaddlePreviewPlanSwitch(runtime, () => Date.UTC(2026, 10, 1))(
      stubCtx(),
      { providerSubscriptionId: "sub/1", targetPriceId: "pri_pro" },
    );
    expect(preview).toEqual({
      amountDueNow: 667,
      tax: 106,
      currency: "eur",
      credit: 333,
      effectiveAt: "2026-11-01T00:00:00Z",
    });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: `${SANDBOX_BASE}/subscriptions/sub%2F1/preview`,
      body: {
        items: [{ price_id: "pri_pro", quantity: 1 }],
        proration_billing_mode: "prorated_immediately",
      },
    });
  });

  test("preview without an immediate transaction owes nothing now", async () => {
    const { runtime } = setup(() => ({ body: previewReply(false) }));
    const preview = await createPaddlePreviewPlanSwitch(runtime, () => 0)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      targetPriceId: "pri_pro",
    });
    expect(preview).toMatchObject({ amountDueNow: 0, tax: null, currency: "eur", credit: 333 });
  });

  test("apply re-sends the bound custom data and keeps the old plan on a failed charge", async () => {
    const { runtime, calls } = setup();
    await createPaddleApplyPlanSwitch(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      targetPriceId: "pri_pro",
      tenantId: "tenant-paddle",
      consentId: "consent-1",
    });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: `${SANDBOX_BASE}/subscriptions/sub_1`,
      body: {
        items: [{ price_id: "pri_pro", quantity: 1 }],
        proration_billing_mode: "prorated_immediately",
        on_payment_failure: "prevent_change",
        custom_data: { tenantId: "tenant-paddle", consentId: "consent-1" },
      },
    });
    const sent = customDataOf(calls[0]);
    expect(
      isValidTenantBinding(TEST_BINDING_KEY, "tenant-paddle", String(sent["tenantBinding"])),
    ).toBe(true);
  });

  test("apply without a consent leaves consentId out", async () => {
    const { runtime, calls } = setup();
    await createPaddleApplyPlanSwitch(runtime)(stubCtx(), {
      providerSubscriptionId: "sub_1",
      targetPriceId: "pri_pro",
      tenantId: "tenant-paddle",
    });
    expect("consentId" in customDataOf(calls[0])).toBe(false);
  });
});

describe("retrieveSubscription", () => {
  const priceToTier = { pri_pro: "pro" };

  test("maps the live state like the webhook does", async () => {
    const { runtime, calls } = setup(() => ({
      body: {
        data: subscriptionData({
          scheduled_change: { action: "cancel", effective_at: "2026-12-01T10:00:00Z" },
        }),
      },
    }));
    const snapshot = await createPaddleRetrieveSubscription(runtime, { priceToTier })(
      stubCtx(),
      "sub_paddle_1",
    );
    expect(snapshot).toEqual({
      providerCustomerId: "ctm_paddle_1",
      providerSubscriptionId: "sub_paddle_1",
      status: "active",
      tier: "pro",
      currentPeriodEnd: "2026-12-01T10:00:00Z",
      cancelAt: "2026-12-01T10:00:00Z",
    });
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${SANDBOX_BASE}/subscriptions/sub_paddle_1`,
    });
  });

  test("a 404 means the subscription is gone", async () => {
    const { runtime } = setup(() => ({ status: 404 }));
    expect(
      await createPaddleRetrieveSubscription(runtime, { priceToTier })(stubCtx(), "sub_gone"),
    ).toBeNull();
  });

  test("other errors propagate", async () => {
    const { runtime } = setup(() => ({ status: 500 }));
    await expect(
      createPaddleRetrieveSubscription(runtime, { priceToTier })(stubCtx(), "sub_1"),
    ).rejects.toThrow(/500/);
  });

  test("an unmapped price yields no snapshot", async () => {
    const { runtime } = setup(() => ({
      body: { data: subscriptionData({ items: [{ price: { id: "pri_other" } }] }) },
    }));
    expect(
      await createPaddleRetrieveSubscription(runtime, { priceToTier })(stubCtx(), "sub_1"),
    ).toBeNull();
  });
});

describe("isBillingEnabled", () => {
  test("needs billingLive, an api key and a tenant binding key", async () => {
    const mock = createSendMock();
    const complete = makeRuntimes(mock.send).ctx;
    expect(await complete.isBillingEnabled(stubCtx({ billingLive: true }))).toBe(true);
    expect(await complete.isBillingEnabled(stubCtx({ billingLive: false }))).toBe(false);
    const noKey = makeRuntimes(mock.send, { tenantBindingKey: TEST_BINDING_KEY }).ctx;
    expect(await noKey.isBillingEnabled(stubCtx({ billingLive: true }))).toBe(false);
    const noBinding = makeRuntimes(mock.send, { apiKey: TEST_API_KEY }).ctx;
    expect(await noBinding.isBillingEnabled(stubCtx({ billingLive: true }))).toBe(false);
  });
});
