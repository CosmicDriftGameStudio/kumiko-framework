// sync-subscription waits for the provider outside any transaction. A pool of POOL_MAX
// connections with more syncs than slots: if each sync held a connection while waiting on the
// provider, only POOL_MAX of them would ever reach it. More syncs than pool slots all reach the
// provider, so none holds a connection while waiting, and an unrelated write still goes through.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
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
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { SUBSCRIPTION_CANCELED_EVENT_QN } from "../events.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type { SubscriptionProviderPlugin } from "../types.ts";
import { SubscriptionFoundationHandlers, SubscriptionStatuses } from "../web/constants.ts";
import { openSubscriptionCheckout, priceIdForTier } from "./ledgered-subscription.ts";

const POOL_MAX = 2;
const CONCURRENT_SYNCS = 3;
const PROVIDER_NAME = "mock-held-provider";
const SYNC_TENANT_NUMBERS = [9711, 9712, 9713] as const;
const PROBE_TENANT_NUMBER = 9714;

let retrieveGate: Promise<void> | undefined;
const retrieveCalls: string[] = [];

const mockHeldProviderFeature = defineFeature("test-mock-held-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    priceToTier: { price_sync_pro: "pro" },
    retrieveSubscription: async (_ctx, providerSubscriptionId) => {
      retrieveCalls.push(providerSubscriptionId);
      await retrieveGate;
      return {
        providerCustomerId: `cus_${providerSubscriptionId}`,
        providerSubscriptionId,
        status: SubscriptionStatuses.canceled,
        tier: "pro",
        currentPeriodEnd: "2026-06-01T00:00:00Z",
        cancelAt: null,
      };
    },
  };
  r.useExtension("subscriptionProvider", PROVIDER_NAME, plugin);
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
      mockHeldProviderFeature,
    ],
    dbPoolMax: POOL_MAX,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function createSubscription(tenantId: string) {
  const admin = createTestUser({ id: 0, tenantId, roles: ["TenantAdmin", "SystemAdmin"] });
  const providerSubscriptionId = `sub_${tenantId}`;
  const providerCheckoutId = await openSubscriptionCheckout(
    (handler, payload) => stack.http.writeOk(handler, payload, admin),
    {
      providerName: PROVIDER_NAME,
      providerSubscriptionId,
      priceId: priceIdForTier({ price_sync_pro: "pro" }, "pro"),
    },
  );
  return stack.http.writeOk(
    SubscriptionFoundationHandlers.processEvent,
    {
      providerEventId: `evt_${tenantId}_create`,
      providerName: PROVIDER_NAME,
      type: "subscription.created",
      providerCheckoutId,
      providerCustomerId: `cus_${providerSubscriptionId}`,
      providerSubscriptionId,
      status: SubscriptionStatuses.active,
      tier: "pro",
      currentPeriodEndIso: "2026-06-01T00:00:00Z",
    },
    admin,
  );
}

describe("sync-subscription outside the transaction", () => {
  test("a slow provider holds no connection: more syncs than pool slots all reach it, and other writes still go through", async () => {
    const tenantIds = SYNC_TENANT_NUMBERS.map((tenantNumber) => testTenantId(tenantNumber));
    for (const tenantId of tenantIds) await createSubscription(tenantId);

    const { promise, resolve } = Promise.withResolvers<void>();
    retrieveGate = promise;
    try {
      const syncs = tenantIds.map((tenantId, index) =>
        stack.http.writeOk(
          SubscriptionFoundationHandlers.syncSubscription,
          {},
          createTestUser({
            id: SYNC_TENANT_NUMBERS[index] ?? 0,
            tenantId,
            roles: ["SystemAdmin"],
          }),
        ),
      );
      await waitFor(() => retrieveCalls.length === CONCURRENT_SYNCS);

      await createSubscription(testTenantId(PROBE_TENANT_NUMBER));

      resolve();
      expect(await Promise.all(syncs)).toEqual(
        Array.from({ length: CONCURRENT_SYNCS }, () => ({ synced: true })),
      );
    } finally {
      retrieveGate = undefined;
      resolve();
    }

    const firstTenantId = tenantIds[0];
    if (firstTenantId === undefined) throw new Error("no sync tenant");
    const stored = await loadAggregate(
      stack.db,
      subscriptionAggregateId(firstTenantId),
      firstTenantId,
    );
    expect(stored.at(-1)?.type).toBe(SUBSCRIPTION_CANCELED_EVENT_QN);
  });
});
