// Integration test: Dodo plugin -> billing-foundation -> database, over real
// HTTP. Dodo's API is replaced by the plugin's `send` seam (egress blocks private
// hosts); everything on our side of it is the real stack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
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
import { subscriptionAggregateId } from "../../billing-foundation/aggregate-id.ts";
import { createBillingFoundationFeature } from "../../billing-foundation/feature.ts";
import { createSubscriptionWebhookRoute } from "../../billing-foundation/index.ts";
import { subscriptionsProjectionTable } from "../../billing-foundation/projection.ts";
import type { BillingPlanCatalog } from "../../billing-foundation/types.ts";
import {
  SubscriptionFoundationHandlers,
  SubscriptionFoundationQueries,
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
import { createSubscriptionDodoFeature } from "../feature.ts";
import {
  createSendMock,
  envelope,
  type RecordedCall,
  subscriptionData,
  TEST_API_KEY,
  TEST_WEBHOOK_SECRET,
  webhookHeaders,
} from "./dodo-test-kit.ts";

const BILLING_LIVE_CONFIG_QN = "subscription-dodo:config:billing-live";
const PRICE_TO_TIER = { pdt_starter: "starter", pdt_pro: "pro" };

const PRODUCTS: Record<string, unknown> = {
  pdt_starter: {
    product_id: "pdt_starter",
    price: {
      type: "recurring_price",
      price: 990,
      currency: "EUR",
      payment_frequency_interval: "Month",
      payment_frequency_count: 1,
    },
  },
  pdt_pro: {
    product_id: "pdt_pro",
    price: {
      type: "recurring_price",
      price: 1990,
      currency: "EUR",
      payment_frequency_interval: "Month",
      payment_frequency_count: 1,
    },
  },
};

function respondLikeDodo(call: RecordedCall) {
  if (call.url.includes("/products/")) {
    return { body: PRODUCTS[call.url.split("/products/")[1] ?? ""] };
  }
  if (call.url.endsWith("/checkouts")) {
    return { body: { session_id: "cks_1", checkout_url: "https://checkout.dodo/cks_1" } };
  }
  if (call.url.endsWith("/change-plan/preview")) {
    return {
      body: {
        immediate_charge: {
          summary: {
            total_amount: 667,
            tax: 106,
            currency: "EUR",
            customer_credits: 333,
            customer_credits_currency: "EUR",
          },
          effective_at: "2026-11-01T10:00:00Z",
        },
      },
    };
  }
  return { body: {} };
}

const dodo = createSendMock(respondLikeDodo);

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
      createSubscriptionDodoFeature({
        apiKey: TEST_API_KEY,
        webhookSecret: TEST_WEBHOOK_SECRET,
        priceToTier: PRICE_TO_TIER,
        send: dodo.send,
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
  const sysAdmin = createTestUser({ id: 9100, tenantId: SYSTEM_TENANT_ID, roles: ["SystemAdmin"] });
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
  dodo.calls.length = 0;
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

async function postDodoWebhook(
  id: string,
  type: string,
  data: unknown,
  options: { readonly secret?: string } = {},
) {
  const body = envelope(type, data);
  return stack.app.request("/api/subscription/webhook/dodo", {
    method: "POST",
    body,
    headers: {
      ...webhookHeaders({ id, timestamp: nowSeconds(), body, secret: options.secret }),
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

async function activateSubscription(tenantNumber: number, productId = "pdt_starter") {
  const response = await postDodoWebhook(
    `msg_${tenantNumber}_active`,
    "subscription.active",
    subscriptionData({
      subscription_id: `sub_${tenantNumber}`,
      product_id: productId,
      customer: { customer_id: `cus_${tenantNumber}` },
      metadata: { tenantId: testTenantId(tenantNumber) },
    }),
  );
  expect(response.status).toBe(200);
}

describe("webhook", () => {
  test("a signed subscription.active writes the subscription for the tenant", async () => {
    await activateSubscription(8101);
    const { rows } = await subscriptionsOf(8101);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerName: "dodo",
      providerSubscriptionId: "sub_8101",
      providerCustomerId: "cus_8101",
      tier: "starter",
      status: "active",
    });
  });

  test("a wrong signature is rejected with 401 and writes nothing", async () => {
    const response = await postDodoWebhook(
      "msg_8102",
      "subscription.active",
      subscriptionData({ metadata: { tenantId: testTenantId(8102) } }),
      { secret: `whsec_${Buffer.from("not-the-key").toString("base64")}` },
    );
    expect(response.status).toBe(401);
    expect((await subscriptionsOf(8102)).rows).toHaveLength(0);
  });
});

describe("checkout", () => {
  test("start-plan-checkout posts the product cart with the tenant id and returns Dodo's url", async () => {
    const admin = adminFor(8110);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    )) as { url: string };
    expect(result.url).toBe("https://checkout.dodo/cks_1");
    const checkout = dodo.calls.find((call) => call.url.endsWith("/checkouts"));
    expect(checkout?.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(checkout?.body).toMatchObject({
      product_cart: [{ product_id: "pdt_pro", quantity: 1 }],
      metadata: { tenantId: admin.tenantId },
      return_url: "https://app.example.com/billing/success",
      cancel_url: "https://app.example.com/billing/cancel",
    });
  });
});

describe("plan switch", () => {
  test("a Dodo subscriber is offered 'switch' for the other plan", async () => {
    await activateSubscription(8120);
    const plans = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      adminFor(8120),
    )) as { plans: Array<{ tier: string; action: string }> };
    expect(plans.plans.find((p) => p.tier === "pro")?.action).toBe("switch");
  });

  test("plan-switch-preview returns Dodo's proration and the target price", async () => {
    await activateSubscription(8121);
    const preview = await stack.http.queryOk(
      SubscriptionFoundationQueries.planSwitchPreview,
      { tier: "pro" },
      adminFor(8121),
    );
    expect(preview).toEqual({
      preview: {
        amountDueNow: 667,
        tax: 106,
        currency: "eur",
        credit: 333,
        effectiveAt: "2026-11-01T10:00:00Z",
      },
      target: {
        tier: "pro",
        unitAmount: 1990,
        currency: "eur",
        interval: "month",
        intervalCount: 1,
      },
    });
  });

  test("switch-plan applies in-app with the tenant id, then plan_changed moves the tier", async () => {
    await activateSubscription(8122);
    const admin = adminFor(8122);
    const result = await stack.http.writeOk(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro" },
      admin,
    );
    expect(result).toEqual({ applied: true });
    const apply = dodo.calls.find((call) =>
      call.url.endsWith("/subscriptions/sub_8122/change-plan"),
    );
    expect(apply?.body).toMatchObject({
      product_id: "pdt_pro",
      on_payment_failure: "prevent_change",
      metadata: { tenantId: admin.tenantId },
    });

    const changed = await postDodoWebhook(
      "msg_8122_changed",
      "subscription.plan_changed",
      subscriptionData({
        subscription_id: "sub_8122",
        product_id: "pdt_pro",
        customer: { customer_id: "cus_8122" },
        metadata: { tenantId: admin.tenantId },
      }),
    );
    expect(changed.status).toBe(200);
    expect((await subscriptionsOf(8122)).rows[0]).toMatchObject({ tier: "pro" });
  });
});
