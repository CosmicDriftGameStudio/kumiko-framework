// Without authorizeOneOffCheckout a one-off checkout behaves as before: the
// oneOffPriceIds gate is the only one.

import { afterAll, beforeAll, expect, test } from "bun:test";
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
import type { SubscriptionProviderPlugin } from "../types.ts";

const ONE_OFF_PRICE = "price_pack_test";

const providerFeature = defineFeature("test-no-hook-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    oneOffPriceIds: [ONE_OFF_PRICE],
    createCheckoutSession: async (_ctx, options) => ({
      url: `https://mock.example/checkout/${options.priceId}`,
    }),
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
      createBillingFoundationFeature({ baseUrl: "https://example.com" }),
      providerFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

test("a one-off checkout without the hook returns the provider url", async () => {
  const result = (await stack.http.writeOk(
    "billing-foundation:write:create-checkout-session",
    {
      providerName: "mock",
      priceId: ONE_OFF_PRICE,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      mode: "payment",
    },
    createTestUser({ id: 4201, tenantId: testTenantId(4201), roles: ["TenantAdmin"] }),
  )) as Record<string, unknown>;
  expect(result["url"]).toBe(`https://mock.example/checkout/${ONE_OFF_PRICE}`);
});
