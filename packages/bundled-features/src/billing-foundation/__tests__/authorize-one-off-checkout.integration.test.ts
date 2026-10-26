// The authorizeOneOffCheckout hook gates mode:"payment" checkouts per tenant,
// before any provider call. Real stack, real HTTP.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type { OneOffCheckoutRequest, SubscriptionProviderPlugin } from "../types.ts";

const ONE_OFF_PRICE = "price_pack_test";
const SUBSCRIPTION_PRICE = "price_pro_test";
const DENIED_CODE = "pack_requires_paid_tier";

const providerCalls: string[] = [];
const hookRequests: OneOffCheckoutRequest[] = [];
let hookAllows = false;

const providerFeature = defineFeature("test-one-off-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    priceToTier: { [SUBSCRIPTION_PRICE]: "pro" },
    oneOffPriceIds: [ONE_OFF_PRICE],
    retrievePrices: async () => {
      providerCalls.push("retrievePrices");
      return [];
    },
    createCheckoutSession: async (_ctx, options) => {
      providerCalls.push("createCheckoutSession");
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
  };
  r.useExtension("subscriptionProvider", "mock", plugin);
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        authorizeOneOffCheckout: async (_ctx, request) => {
          hookRequests.push(request);
          return hookAllows
            ? { allowed: true }
            : {
                allowed: false,
                reason: DENIED_CODE,
                i18nKey: "test.errors.packRequiresPaidTier",
              };
        },
      }),
      providerFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

function checkoutPayload(priceId: string, mode: "payment" | "subscription") {
  return {
    providerName: "mock",
    priceId,
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    mode,
  };
}

function resetObservations(allows: boolean): void {
  providerCalls.length = 0;
  hookRequests.length = 0;
  hookAllows = allows;
}

describe("authorizeOneOffCheckout", () => {
  test("a rejection answers 422 with the hook's code and never reaches the provider", async () => {
    resetObservations(false);
    const admin = adminFor(4101);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      checkoutPayload(ONE_OFF_PRICE, "payment"),
      admin,
    );
    expect(JSON.stringify(error)).toContain(DENIED_CODE);
    expect(JSON.stringify(error)).not.toContain(ONE_OFF_PRICE);
    expect(providerCalls).toEqual([]);
    expect(hookRequests).toEqual([
      { tenantId: admin.tenantId, providerName: "mock", priceId: ONE_OFF_PRICE },
    ]);
  });

  test("an allowed one-off checkout returns the provider url after one provider call", async () => {
    resetObservations(true);
    const admin = adminFor(4102);
    const result = (await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      checkoutPayload(ONE_OFF_PRICE, "payment"),
      admin,
    )) as Record<string, unknown>;
    expect(result["url"]).toBe(`https://mock.example/checkout/${ONE_OFF_PRICE}`);
    expect(providerCalls).toEqual(["createCheckoutSession"]);
    expect(hookRequests).toEqual([
      { tenantId: admin.tenantId, providerName: "mock", priceId: ONE_OFF_PRICE },
    ]);
  });

  test("a subscription checkout never calls the hook", async () => {
    resetObservations(false);
    const result = (await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      checkoutPayload(SUBSCRIPTION_PRICE, "subscription"),
      adminFor(4103),
    )) as Record<string, unknown>;
    expect(result["url"]).toBe(`https://mock.example/checkout/${SUBSCRIPTION_PRICE}`);
    expect(hookRequests).toEqual([]);
  });
});
