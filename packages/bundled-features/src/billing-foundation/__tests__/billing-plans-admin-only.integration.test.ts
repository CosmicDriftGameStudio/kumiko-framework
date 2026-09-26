// Admin-only billing-plans catalog — a separate stack (own viewRoles/
// purchaseRoles: ["Admin"]) instead of a describe-block inside
// billing-plans.integration.test.ts, matching how show-pony pins a distinct
// role-shape against its own setupTestStack rather than layering it onto a
// shared one. Proves the catalog's role-gate isn't hardcoded to
// TenantAdmin/SystemAdmin: an app that restricts billing to a custom "Admin"
// role locks TenantAdmin out of both the query and the purchase-handlers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { subscriptionAggregateId } from "../aggregate-id";
import { SubscriptionFoundationHandlers, SubscriptionStatuses } from "../constants";
import { createBillingFoundationFeature } from "../feature";
import { subscriptionsProjectionTable } from "../projection";
import type { BillingPlanCatalog, ProviderPrice, SubscriptionProviderPlugin } from "../types";

const PRICE_TO_TIER: Readonly<Record<string, string>> = { price_pro: "pro" };

const PRICES: readonly ProviderPrice[] = [
  {
    priceId: "price_pro",
    unitAmount: 1900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
  },
];

const checkoutCalls: Array<{ priceId: string }> = [];

const adminOnlyProviderFeature = defineFeature("test-mock-admin-only-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    priceToTier: PRICE_TO_TIER,
    retrievePrices: async (_ctx, priceIds) => PRICES.filter((p) => priceIds.includes(p.priceId)),
    createCheckoutSession: async (_ctx, options) => {
      checkoutCalls.push({ priceId: options.priceId });
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
  };
  r.useExtension("subscriptionProvider", "mock-admin-only-provider", plugin);
});

async function resolveCurrentTier(db: TenantDb, tenantId: string): Promise<string> {
  const rows = await db.selectMany(
    subscriptionsProjectionTable,
    { id: subscriptionAggregateId(tenantId) },
    { limit: 1 },
  );
  const row = rows[0];
  if (!row) return "free";
  const status = row["status"] as string;
  return status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing
    ? (row["tier"] as string)
    : "free";
}

const adminOnlyCatalog: BillingPlanCatalog<"pro"> = {
  plans: ["pro"],
  tierLabelKey: (tier) => `plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier,
  viewRoles: ["Admin"],
  purchaseRoles: ["Admin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  providerName: "mock-admin-only-provider",
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({
        baseUrl: "https://app.example.com",
        catalog: adminOnlyCatalog,
      }),
      adminOnlyProviderFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("billing-plans catalog with viewRoles/purchaseRoles restricted to a custom Admin role", () => {
  test("an Admin can query the catalog and start a checkout through to the mock provider", async () => {
    const admin = createTestUser({ id: 8001, tenantId: testTenantId(8001), roles: ["Admin"] });

    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      admin,
    )) as {
      canPurchase: boolean;
      plans: Array<{ tier: string; action: string }>;
    };
    expect(result.canPurchase).toBe(true);
    expect(result.plans.find((p) => p.tier === "pro")?.action).toBe("checkout");

    const checkout = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    )) as { url: string };
    expect(checkout.url).toBe("https://mock.example/checkout/price_pro");
    expect(checkoutCalls).toEqual([{ priceId: "price_pro" }]);
  });

  test("a TenantAdmin without the Admin role is rejected on both query and start-plan-checkout", async () => {
    const tenantAdmin = createTestUser({
      id: 8002,
      tenantId: testTenantId(8002),
      roles: ["TenantAdmin"],
    });

    const queryError = await stack.http.queryErr(
      "billing-foundation:query:billing-plans",
      {},
      tenantAdmin,
    );
    expect(queryError.httpStatus).toBe(403);

    const writeError = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      tenantAdmin,
    );
    expect(writeError.httpStatus).toBe(403);
  });
});
