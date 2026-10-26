// A one-off checkout reuses the provider customer of the tenant's own subscription at the
// same provider. Real stack, real HTTP.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
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
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../web/constants.ts";

const ONE_OFF_PRICE = "price_pack_test";
const customersSeen: Array<string | undefined> = [];

const providerFeature = defineFeature("test-prefill-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    oneOffPriceIds: [ONE_OFF_PRICE],
    createCheckoutSession: async (_ctx, options) => {
      customersSeen.push(options.providerCustomerId);
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
      createBillingFoundationFeature({ baseUrl: "https://example.com" }),
      providerFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function buyPack(admin: ReturnType<typeof adminFor>): Promise<void> {
  await stack.http.writeOk(
    "billing-foundation:write:create-checkout-session",
    {
      providerName: "mock",
      priceId: ONE_OFF_PRICE,
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
      mode: "payment",
    },
    admin,
  );
}

describe("one-off checkout customer prefill", () => {
  test("a tenant with a subscription at the same provider passes its customer id", async () => {
    const admin = adminFor(4301);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.processEvent,
      {
        providerEventId: "evt_4301",
        providerName: "mock",
        type: SubscriptionEventTypes.created,
        providerCustomerId: "cus_4301",
        providerSubscriptionId: "sub_4301",
        status: SubscriptionStatuses.active,
        tier: "pro",
        currentPeriodEndIso: "2026-12-01T00:00:00Z",
      },
      admin,
    );
    customersSeen.length = 0;
    await buyPack(admin);
    expect(customersSeen).toEqual(["cus_4301"]);
  });

  test("a tenant without a subscription passes no customer id", async () => {
    customersSeen.length = 0;
    await buyPack(adminFor(4302));
    expect(customersSeen).toEqual([undefined]);
  });
});
