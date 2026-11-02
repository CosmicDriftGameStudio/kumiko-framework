// Integration test: Paddle plugin -> billing-foundation -> database, plus the
// Default Payment Link page, over real HTTP. Paddle's API is replaced by the
// plugin's `send` seam (egress blocks private hosts); everything on our side of
// it is the real stack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { selectMany, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  paymentAggregateId,
  subscriptionAggregateId,
} from "../../billing-foundation/aggregate-id.ts";
import { createBillingFoundationFeature } from "../../billing-foundation/feature.ts";
import { createSubscriptionWebhookRoute } from "../../billing-foundation/index.ts";
import {
  paymentsProjectionTable,
  subscriptionsProjectionTable,
} from "../../billing-foundation/projection.ts";
import type { BillingPlanCatalog } from "../../billing-foundation/types.ts";
import {
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../../billing-foundation/web/constants.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { configValuesTable, createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { PADDLE_INIT_SCRIPT } from "../checkout-page.ts";
import { PADDLE_CHECKOUT_PATH } from "../constants.ts";
import { createSubscriptionPaddleFeature } from "../feature.ts";
import {
  createSendMock,
  envelope,
  type RecordedCall,
  subscriptionData,
  TEST_API_KEY,
  TEST_WEBHOOK_SECRET,
  tenantCustomData,
  webhookHeaders,
} from "./paddle-test-kit.ts";

const BILLING_LIVE_CONFIG_QN = "subscription-paddle:config:billing-live";
const CLIENT_TOKEN_CONFIG_QN = "subscription-paddle:config:client-token";
const PRICE_TO_TIER = { pri_starter: "starter", pri_pro: "pro" };
const ONE_OFF_PRICE = "pri_topup";
const CLIENT_TOKEN = "test_integration_client_token";

let transactionCounter = 0;

function respondLikePaddle(call: RecordedCall) {
  if (call.method === "GET" && call.url.includes("/prices")) {
    const ids = (new URL(call.url).searchParams.get("id") ?? "").split(",");
    return {
      body: {
        data: ids.map((id) => ({
          id,
          unit_price: { amount: id === "pri_pro" ? "1990" : "990", currency_code: "EUR" },
          billing_cycle: { interval: "month", frequency: 1 },
          status: "active",
          custom_data: null,
          product: { custom_data: null },
        })),
      },
    };
  }
  if (call.method === "POST" && call.url.endsWith("/transactions")) {
    transactionCounter += 1;
    const id = `txn_${transactionCounter}`;
    return {
      body: {
        data: {
          id,
          checkout: { url: `https://app.example.com/billing/paddle-checkout?_ptxn=${id}` },
        },
      },
    };
  }
  return { body: {} };
}

const paddle = createSendMock(respondLikePaddle);

async function resolveCurrentTier(db: TenantDb, tenantId: string): Promise<string> {
  const rows = await db.selectMany(
    subscriptionsProjectionTable,
    { id: subscriptionAggregateId(tenantId) },
    { limit: 1 },
  );
  const row = rows[0];
  if (!row) return "free";
  const status = row["status"];
  const tier = row["tier"];
  return (status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing) &&
    typeof tier === "string"
    ? tier
    : "free";
}

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  tierLabelKey: (tier) => `plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier,
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
};

const sysAdmin = createTestUser({ id: 9100, tenantId: SYSTEM_TENANT_ID, roles: ["SystemAdmin"] });

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({ baseUrl: "https://app.example.com", catalog }),
      // No clientToken fallback on purpose: the page must read it from config.
      createSubscriptionPaddleFeature({
        apiKey: TEST_API_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        priceToTier: PRICE_TO_TIER,
        oneOffPriceIds: [ONE_OFF_PRICE],
        send: paddle.send,
      }),
    ],
    masterKeyProvider,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider, registry }),
    }),
    extraRoutes: [createSubscriptionWebhookRoute()],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  await stack.http.writeOk(
    "config:write:set",
    { key: BILLING_LIVE_CONFIG_QN, value: true, scope: "system" },
    sysAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  paddle.calls.length = 0;
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function nowSeconds(): string {
  return String(Math.floor(Temporal.Now.instant().epochMilliseconds / 1000));
}

async function postPaddleWebhook(
  eventId: string,
  type: string,
  data: unknown,
  options: { readonly secret?: string } = {},
) {
  const body = envelope(type, data, eventId);
  return stack.app.request("/api/subscription/webhook/paddle", {
    method: "POST",
    body,
    headers: {
      ...webhookHeaders({ timestamp: nowSeconds(), body, secret: options.secret }),
      "content-type": "application/json",
    },
  });
}

type SubscriptionRows = { rows: Array<Record<string, unknown>> };

async function subscriptionsOf(tenantNumber: number) {
  return (await stack.http.queryOk(
    "billing-foundation:query:subscription:list",
    {},
    adminFor(tenantNumber),
  )) as SubscriptionRows;
}

function transactionIdOf(checkout: { readonly url: string }): string {
  return new URL(checkout.url).searchParams.get("_ptxn") ?? "";
}

async function openPlanCheckout(tenantNumber: number, tier: string): Promise<string> {
  const result = (await stack.http.writeOk(
    SubscriptionFoundationHandlers.startPlanCheckout,
    { tier },
    adminFor(tenantNumber),
  )) as { url: string };
  return transactionIdOf(result);
}

async function openOneOffCheckout(tenantNumber: number): Promise<string> {
  const result = (await stack.http.writeOk(
    SubscriptionFoundationHandlers.createCheckoutSession,
    {
      providerName: "paddle",
      priceId: ONE_OFF_PRICE,
      successUrl: "https://app.example.com/billing/success",
      cancelUrl: "https://app.example.com/billing/cancel",
      mode: "payment",
    },
    adminFor(tenantNumber),
  )) as { url: string };
  return transactionIdOf(result);
}

function oneOffTransaction(tenantNumber: number, transactionId: string, quantity?: number) {
  return {
    id: transactionId,
    subscription_id: null,
    customer_id: `ctm_${tenantNumber}`,
    custom_data: tenantCustomData(testTenantId(tenantNumber)),
    items: [{ price: { id: ONE_OFF_PRICE }, ...(quantity !== undefined && { quantity }) }],
  };
}

async function activateSubscription(tenantNumber: number, priceId = "pri_starter") {
  const tier = priceId === "pri_pro" ? "pro" : "starter";
  const transactionId = await openPlanCheckout(tenantNumber, tier);
  const response = await postPaddleWebhook(
    `evt_${tenantNumber}_created`,
    "subscription.created",
    subscriptionData({
      id: `sub_${tenantNumber}`,
      transaction_id: transactionId,
      customer_id: `ctm_${tenantNumber}`,
      items: [{ price: { id: priceId } }],
      custom_data: tenantCustomData(testTenantId(tenantNumber)),
    }),
  );
  expect(response.status).toBe(200);
}

describe("checkout page", () => {
  const page = (query: string) => stack.app.request(`${PADDLE_CHECKOUT_PATH}?${query}`);

  test("answers 503 while no client token is configured", async () => {
    const response = await page("_ptxn=txn_1");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("<script");
  });

  test("serves the page with the token from config, a matching CSP hash and strict headers", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: CLIENT_TOKEN_CONFIG_QN, value: CLIENT_TOKEN, scope: "system" },
      sysAdmin,
    );
    const response = await page(
      "_ptxn=txn_1&success=%2Fbilling%2Fsuccess&cancel=%2Fbilling%2Fcancel&locale=de",
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`data-client-token="${CLIENT_TOKEN}"`);
    expect(html).toContain('data-success-url="/billing/success"');
    expect(html).toContain('data-cancel-url="/billing/cancel"');
    expect(html).toContain('data-locale="de"');
    expect(html).toContain('data-environment="sandbox"');

    const csp = response.headers.get("content-security-policy") ?? "";
    const hash = createHash("sha256").update(PADDLE_INIT_SCRIPT).digest("base64");
    expect(csp).toContain(`script-src 'sha256-${hash}' https://cdn.paddle.com`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(html).toContain(`<script>${PADDLE_INIT_SCRIPT}</script>`);
    expect(html).toContain('<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>');
    expect(html).not.toContain("integrity=");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("never reflects _ptxn into the body", async () => {
    const response = await page("_ptxn=txn_REFLECTED_MARKER");
    expect(await response.text()).not.toContain("txn_REFLECTED_MARKER");
  });

  test("falls back to / for redirect targets that leave the origin", async () => {
    for (const target of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      const response = await page(
        `success=${encodeURIComponent(target)}&cancel=${encodeURIComponent(target)}`,
      );
      const html = await response.text();
      expect(html).toContain('data-success-url="/"');
      expect(html).toContain('data-cancel-url="/"');
      expect(html).not.toContain("evil.com");
    }
  });

  test("escapes attribute values and drops malformed locales", async () => {
    const response = await page(
      `success=${encodeURIComponent('/ok"><script>alert(1)</script>')}&locale=${encodeURIComponent('x"><b>')}`,
    );
    const html = await response.text();
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain("&quot;");
    expect(html).not.toContain("data-locale");
  });
});

describe("webhook", () => {
  test("a signed subscription.created for a checkout the server opened writes the subscription", async () => {
    await activateSubscription(8101);
    const { rows } = await subscriptionsOf(8101);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerName: "paddle",
      providerSubscriptionId: "sub_8101",
      providerCustomerId: "ctm_8101",
      tier: "starter",
      status: "active",
    });
  });

  test("a wrong signature is rejected with 401 and writes nothing", async () => {
    const response = await postPaddleWebhook(
      "evt_8102",
      "subscription.created",
      subscriptionData({ custom_data: tenantCustomData(testTenantId(8102)) }),
      { secret: "not-the-secret" },
    );
    expect(response.status).toBe(401);
    expect((await subscriptionsOf(8102)).rows).toHaveLength(0);
  });

  test("an event naming a foreign tenant's tenantId without a checkout of that tenant is ignored", async () => {
    const victim = 8103;
    const attacker = 8104;
    await activateSubscription(victim, "pri_starter");
    const before = (await subscriptionsOf(victim)).rows[0];

    // Valid Paddle signature, as if Paddle.js opened a checkout with forged customData.
    const attackerTransaction = await openPlanCheckout(attacker, "pro");
    for (const [suffix, type, transaction_id] of [
      ["updated", "subscription.updated", attackerTransaction],
      ["created", "subscription.created", attackerTransaction],
    ] as const) {
      const response = await postPaddleWebhook(
        `evt_${victim}_${suffix}`,
        type,
        subscriptionData({
          id: `sub_forged_${suffix}`,
          transaction_id,
          items: [{ price: { id: "pri_pro" } }],
          custom_data: tenantCustomData(testTenantId(victim)),
        }),
      );
      expect(response.status).toBe(200);
    }

    const after = (await subscriptionsOf(victim)).rows[0];
    expect(after).toEqual(before);
    expect(after).toMatchObject({ tier: "starter", providerSubscriptionId: `sub_${victim}` });
    expect((await subscriptionsOf(attacker)).rows).toHaveLength(0);
  });

  test("a transaction.completed for a one-off checkout the server opened writes a payment row", async () => {
    const tenantNumber = 8105;
    const tenantId = testTenantId(tenantNumber);
    const transactionId = await openOneOffCheckout(tenantNumber);
    const response = await postPaddleWebhook(
      "evt_8105_txn",
      "transaction.completed",
      oneOffTransaction(tenantNumber, transactionId),
    );
    expect(response.status).toBe(200);
    const rows = await selectMany(stack.db, paymentsProjectionTable, { tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ providerName: "paddle", providerCustomerId: "ctm_8105" });
  });

  test("the bought quantity reaches the stored payment event, and defaults to 1", async () => {
    const packs = 8106;
    const single = 8107;
    for (const [tenantNumber, quantity] of [
      [packs, 3],
      [single, undefined],
    ] as const) {
      const transactionId = await openOneOffCheckout(tenantNumber);
      const response = await postPaddleWebhook(
        `evt_txn_${tenantNumber}`,
        "transaction.completed",
        oneOffTransaction(tenantNumber, transactionId, quantity),
      );
      expect(response.status).toBe(200);
    }
    const paymentOf = async (tenantNumber: number) => {
      const tenantId = testTenantId(tenantNumber);
      const events = await loadAggregate(stack.db, paymentAggregateId(tenantId), tenantId);
      return events.find((event) => event.type.endsWith("payment-received"))?.payload;
    };
    expect(await paymentOf(packs)).toMatchObject({ priceId: ONE_OFF_PRICE, quantity: 3 });
    expect(await paymentOf(single)).toMatchObject({ priceId: ONE_OFF_PRICE, quantity: 1 });
  });
});

describe("checkout", () => {
  test("start-plan-checkout creates a transaction and returns the page url with relative targets", async () => {
    const admin = adminFor(8110);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    )) as { url: string };

    const transaction = paddle.calls.find((call) => call.url.endsWith("/transactions"));
    expect(transaction?.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(transaction?.body).toMatchObject({
      items: [{ price_id: "pri_pro", quantity: 1 }],
      custom_data: { tenantId: admin.tenantId },
    });
    expect(transaction?.body).not.toHaveProperty("checkout");
    const url = new URL(result.url);
    expect(url.pathname).toBe(PADDLE_CHECKOUT_PATH);
    expect(url.searchParams.get("_ptxn")).toBe(`txn_${transactionCounter}`);
    expect(url.searchParams.get("success")).toBe("/billing/success");
    expect(url.searchParams.get("cancel")).toBe("/billing/cancel");
  });

  test("the page url the checkout returns is served by the real page", async () => {
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      adminFor(8111),
    )) as { url: string };
    const url = new URL(result.url);
    const response = await stack.app.request(`${url.pathname}${url.search}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-success-url="/billing/success"');
  });
});

describe("checkout ledger: webhooks for checkouts the server never opened", () => {
  async function openLegitCheckoutAndCaptureCustomData(tenantNumber: number) {
    paddle.calls.length = 0;
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      adminFor(tenantNumber),
    );
    const transaction = paddle.calls.find((call) => call.url.endsWith("/transactions"));
    const customData = propertyOf(transaction?.body, "custom_data");
    if (!isPlainObject(customData)) throw new Error("checkout transaction carried no custom_data");
    return customData;
  }

  test("a transaction.completed for a foreign transaction id with replayed custom_data writes no payment", async () => {
    const tenantNumber = 8120;
    const tenantId = testTenantId(tenantNumber);
    const customData = await openLegitCheckoutAndCaptureCustomData(tenantNumber);

    const response = await postPaddleWebhook("evt_8120_forged_txn", "transaction.completed", {
      id: "txn_forged_8120",
      subscription_id: null,
      customer_id: "ctm_8120",
      custom_data: { ...customData, consentId: "forged-consent" },
      items: [{ price: { id: ONE_OFF_PRICE } }],
    });
    expect(response.status).toBe(200);
    expect(await selectMany(stack.db, paymentsProjectionTable, { tenantId })).toHaveLength(0);
    expect(
      await loadAggregate(stack.db, paymentAggregateId(tenantId), tenantId),
    ).not.toContainEqual(
      expect.objectContaining({ type: expect.stringContaining("payment-received") }),
    );
  });

  test("a subscription.created naming an unknown transaction with replayed custom_data writes no subscription", async () => {
    const tenantNumber = 8121;
    const customData = await openLegitCheckoutAndCaptureCustomData(tenantNumber);

    const response = await postPaddleWebhook(
      "evt_8121_forged_sub",
      "subscription.created",
      subscriptionData({
        id: "sub_forged_8121",
        transaction_id: "txn_forged_8121",
        items: [{ price: { id: "pri_pro" } }],
        custom_data: customData,
      }),
    );
    expect(response.status).toBe(200);
    expect((await subscriptionsOf(tenantNumber)).rows).toHaveLength(0);
  });
});
