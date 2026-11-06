// A tenant that keeps opening checkouts is limited, because each start appends a ledger event to
// its event stream; other tenants keep their own budget.

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
import { CHECKOUT_START_RATE_LIMIT } from "../checkout-core.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type { SubscriptionProviderPlugin } from "../types.ts";

const ONE_OFF_PRICE = "price_pack_test";

const providerFeature = defineFeature("test-rate-limit-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    oneOffPriceIds: [ONE_OFF_PRICE],
    createCheckoutSession: async (_ctx, options) => ({
      url: `https://mock.example/checkout/${options.priceId}`,
      providerCheckoutId: `cs_${options.priceId}`,
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

const startCheckout = (user: ReturnType<typeof createTestUser>) =>
  stack.http.write(
    "billing-foundation:write:create-checkout-session",
    {
      providerName: "mock",
      priceId: ONE_OFF_PRICE,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      mode: "payment",
    },
    user,
  );

test("the start beyond the hourly limit is rejected, another tenant is untouched", async () => {
  const busy = createTestUser({ id: 4301, tenantId: testTenantId(4301), roles: ["TenantAdmin"] });
  const other = createTestUser({ id: 4302, tenantId: testTenantId(4302), roles: ["TenantAdmin"] });

  for (let started = 0; started < CHECKOUT_START_RATE_LIMIT.limit; started++) {
    expect((await startCheckout(busy)).status).toBe(200);
  }
  expect((await startCheckout(busy)).status).toBe(429);
  expect((await startCheckout(other)).status).toBe(200);
});
