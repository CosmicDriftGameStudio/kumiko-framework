// Runs the real mollie-api-typescript Client (zod-validated responses) against
// a local stub server, so a wrong unwrap in the adapter fails here instead of
// at runtime.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { Client } from "mollie-api-typescript";
import { mollieClientShapeOf } from "../adapter.ts";
import { createMollieCheckoutSession } from "../plugin-methods.ts";
import { verifyAndParseMollieWebhook } from "../verify-webhook.ts";

type SeenRequest = {
  readonly method: string;
  readonly path: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
};

const seen: SeenRequest[] = [];

const url = (href: string) => ({ href, type: "application/hal+json" });
const AMOUNT = { currency: "EUR", value: "9.99" };

const paymentBody = (extra: Record<string, unknown> = {}) => ({
  resource: "payment",
  id: "tr_stub_1",
  mode: "test",
  amount: AMOUNT,
  description: "Pro Plan",
  sequenceType: "first",
  status: "paid",
  customerId: "cst_stub_1",
  subscriptionId: null,
  metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
  createdAt: "2026-05-01T10:00:00+00:00",
  profileId: "pfl_stub",
  redirectUrl: "https://example.com/success",
  _links: {
    self: url("https://api.mollie.com/v2/payments/tr_stub_1"),
    checkout: url("https://www.mollie.com/checkout/stub"),
    dashboard: url("https://my.mollie.com/dashboard/pay/tr_stub_1"),
    documentation: url("https://docs.mollie.com"),
  },
  ...extra,
});

const subscriptionBody = (id: string) => ({
  resource: "subscription",
  id,
  mode: "test",
  status: "active",
  amount: AMOUNT,
  times: null,
  timesRemaining: null,
  interval: "1 month",
  startDate: "2026-05-01",
  nextPaymentDate: "2026-06-01",
  description: "Pro Plan",
  method: null,
  metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
  webhookUrl: null,
  customerId: "cst_stub_1",
  createdAt: "2026-05-01T10:00:00+00:00",
  _links: {
    self: url(`https://api.mollie.com/v2/customers/cst_stub_1/subscriptions/${id}`),
    customer: url("https://api.mollie.com/v2/customers/cst_stub_1"),
    profile: url("https://api.mollie.com/v2/profiles/pfl_stub"),
    documentation: url("https://docs.mollie.com"),
  },
});

const customerBody = {
  resource: "customer",
  id: "cst_stub_1",
  mode: "test",
  name: null,
  email: null,
  locale: null,
  metadata: { tenantId: "tenant-1" },
  createdAt: "2026-05-01T10:00:00+00:00",
  _links: {
    self: url("https://api.mollie.com/v2/customers/cst_stub_1"),
    dashboard: url("https://my.mollie.com/dashboard/cst_stub_1"),
    documentation: url("https://docs.mollie.com"),
  },
};

function respond(method: string, path: string): { status: number; body: unknown } {
  if (method === "GET" && path === "/v2/payments/tr_stub_1") {
    return { status: 200, body: paymentBody() };
  }
  if (method === "GET" && path === "/v2/payments/tr_bad") {
    const { _links: _omitted, ...withoutLinks } = paymentBody();
    return { status: 200, body: withoutLinks };
  }
  if (method === "GET" && path === "/v2/payments/tr_missing") {
    return {
      status: 404,
      body: {
        status: 404,
        title: "Not Found",
        detail: "No payment exists with token tr_missing.",
        _links: {
          documentation: url("https://docs.mollie.com/errors"),
        },
      },
    };
  }
  if (method === "POST" && path === "/v2/payments") {
    return { status: 201, body: paymentBody({ status: "open" }) };
  }
  if (method === "POST" && path === "/v2/customers") return { status: 201, body: customerBody };
  if (method === "GET" && path === "/v2/customers/cst_stub_1/subscriptions/sub_stub_1") {
    return { status: 200, body: subscriptionBody("sub_stub_1") };
  }
  if (method === "GET" && path === "/v2/customers/cst_stub_1/subscriptions") {
    return {
      status: 200,
      body: {
        count: 1,
        _embedded: { subscriptions: [subscriptionBody("sub_stub_1")] },
        _links: {
          self: url("https://api.mollie.com/v2/customers/cst_stub_1/subscriptions"),
          previous: null,
          next: null,
          documentation: url("https://docs.mollie.com"),
        },
      },
    };
  }
  if (method === "POST" && path === "/v2/customers/cst_stub_1/subscriptions") {
    return { status: 201, body: subscriptionBody("sub_created") };
  }
  return { status: 404, body: { status: 404, title: "Not Found", detail: path } };
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const text = await req.text();
    seen.push({
      method: req.method,
      path: pathname,
      idempotencyKey: req.headers.get("idempotency-key"),
      body: text.length > 0 ? JSON.parse(text) : undefined,
    });
    const { status, body } = respond(req.method, pathname);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/hal+json" },
    });
  },
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  seen.length = 0;
});

const client = new Client({
  security: { apiKey: "test_x" },
  serverURL: `http://127.0.0.1:${server.port}`,
});
const adapter = mollieClientShapeOf(client);

describe("mollieClientShapeOf against the real SDK client", () => {
  test("payments.get returns the fields the plugin reads", async () => {
    const payment = await adapter.payments.get("tr_stub_1");
    expect(payment).toMatchObject({
      id: "tr_stub_1",
      customerId: "cst_stub_1",
      sequenceType: "first",
      status: "paid",
      metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
    });
  });

  test("customerSubscriptions.get returns the fields the plugin reads", async () => {
    const sub = await adapter.customerSubscriptions.get("sub_stub_1", "cst_stub_1");
    expect(sub).toMatchObject({
      id: "sub_stub_1",
      customerId: "cst_stub_1",
      status: "active",
      nextPaymentDate: "2026-06-01",
      startDate: "2026-05-01",
      metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
    });
  });

  test("customerSubscriptions.list unwraps _embedded.subscriptions", async () => {
    const subs = await adapter.customerSubscriptions.list("cst_stub_1");
    expect(subs.map((sub) => sub.id)).toEqual(["sub_stub_1"]);
  });

  test("customerSubscriptions.create puts customerId in the path and params in the body", async () => {
    const created = await adapter.customerSubscriptions.create("cst_stub_1", {
      amount: AMOUNT,
      interval: "1 month",
      description: "Pro Plan",
      metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
    });
    expect(created.id).toBe("sub_created");
    const post = seen.find((r) => r.method === "POST");
    expect(post?.path).toBe("/v2/customers/cst_stub_1/subscriptions");
    expect(post?.body).toMatchObject({
      amount: AMOUNT,
      interval: "1 month",
      description: "Pro Plan",
      metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
    });
    expect(post?.idempotencyKey).toBeTruthy();
  });
});

describe("createMollieCheckoutSession against the real SDK client", () => {
  test("creates customer + first payment and returns the checkout url and payment id", async () => {
    const checkout = createMollieCheckoutSession(
      client,
      {
        plan_pro: {
          amountValue: "9.99",
          amountCurrency: "EUR",
          interval: "1 month",
          description: "Pro Plan",
        },
      },
      "https://app.example.com/api/subscription/webhook/mollie",
    );
    const result = await checkout({} as HandlerContext, {
      priceId: "plan_pro",
      tenantId: "tenant-1",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
    expect(result).toEqual({
      url: "https://www.mollie.com/checkout/stub",
      providerCheckoutId: "tr_stub_1",
    });
    const posts = seen.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.path)).toEqual(["/v2/customers", "/v2/payments"]);
    expect(posts.every((r) => r.idempotencyKey)).toBe(true);
    expect(posts[1]?.body).toMatchObject({
      sequenceType: "first",
      customerId: "cst_stub_1",
      metadata: { tenantId: "tenant-1", priceId: "plan_pro" },
    });
  });
});

describe("verifyAndParseMollieWebhook with the real SDK client", () => {
  const verify = verifyAndParseMollieWebhook(adapter, {
    priceToTier: { plan_pro: "pro" },
    priceToConfig: {
      plan_pro: {
        amountValue: "9.99",
        amountCurrency: "EUR",
        interval: "1 month",
        description: "Pro Plan",
      },
    },
  });
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };

  test("form-urlencoded id → event built from zod-parsed metadata", async () => {
    // Stub payment is first+paid without subscriptionId → plugin creates the subscription.
    const event = await verify("id=tr_stub_1", formHeaders);
    expect(event).toMatchObject({
      providerEventId: "tr_stub_1",
      tenantId: "tenant-1",
      tier: "pro",
      providerSubscriptionId: "sub_stub_1",
      providerCheckoutId: "tr_stub_1",
    });
  });

  test("response that fails SDK validation throws instead of being ignored", async () => {
    await expect(verify("id=tr_bad", formHeaders)).rejects.toThrow();
  });

  test("404 from Mollie → null", async () => {
    expect(await verify("id=tr_missing", formHeaders)).toBeNull();
  });
});
