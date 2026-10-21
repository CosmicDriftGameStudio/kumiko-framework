// Unit-test for effectiveTierFromSubscription. The DB-touching half
// (syncTierFromSubscription, the wired route) is exercised via the app-level
// test suites of its two current consumers (show-pony, publicstatus) — those
// migrate onto this factory in a follow-up PR, carrying their
// existing integration coverage with them.

import { describe, expect, test } from "bun:test";
import {
  TierAssignmentSources,
  TierEngineQueries,
  tierAssignmentAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import type { TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import {
  createSubscriptionTierSync,
  effectiveTierFromSubscription,
  TIER_SYNC_MANUAL_GRANT_SKIPPED,
} from "../subscription-tier-sync.ts";
import type { SubscriptionEvent } from "../types.ts";
import {
  BillingEventKinds,
  SubscriptionEventTypes,
  SubscriptionFoundationQueries,
  SubscriptionStatuses,
} from "../web/constants.ts";

type TestTier = "free" | "starter" | "pro";
const isTierName = (v: string): v is TestTier => v === "free" || v === "starter" || v === "pro";

describe("effectiveTierFromSubscription", () => {
  test("active subscription with a known tier → that tier", () => {
    expect(
      effectiveTierFromSubscription(SubscriptionStatuses.active, "pro", isTierName, "free"),
    ).toBe("pro");
  });

  test("trialing counts as usable", () => {
    expect(
      effectiveTierFromSubscription(SubscriptionStatuses.trialing, "starter", isTierName, "free"),
    ).toBe("starter");
  });

  test("canceled/past_due/unknown status → default tier", () => {
    expect(effectiveTierFromSubscription("canceled", "pro", isTierName, "free")).toBe("free");
    expect(effectiveTierFromSubscription(undefined, "pro", isTierName, "free")).toBe("free");
  });

  test("unrecognized tier name → default tier", () => {
    expect(
      effectiveTierFromSubscription(SubscriptionStatuses.active, "enterprise", isTierName, "free"),
    ).toBe("free");
  });
});

describe("syncTierFromSubscription with a manual grant", () => {
  const tenantId = "00000000-0000-4000-8000-000000000042" as TenantId;
  const { syncTierFromSubscription } = createSubscriptionTierSync({
    isTierName,
    defaultTier: "free",
  });

  function fakeRouteDeps(grantedTier: TestTier, subscribedTier: TestTier) {
    const writes: string[] = [];
    return {
      writes,
      deps: {
        dispatchSystemQuery: async ({ handlerQn }: { handlerQn: string }) => {
          if (handlerQn === SubscriptionFoundationQueries.listSubscriptions) {
            return {
              rows: [
                {
                  id: subscriptionAggregateId(tenantId),
                  status: SubscriptionStatuses.active,
                  tier: subscribedTier,
                },
              ],
            };
          }
          expect(handlerQn).toBe(TierEngineQueries.list);
          return {
            rows: [
              {
                id: tierAssignmentAggregateId(tenantId),
                version: 1,
                tenantId,
                tier: grantedTier,
                source: TierAssignmentSources.manual,
              },
            ],
          };
        },
        dispatchSystemWrite: async ({ handlerQn }: { handlerQn: string }): Promise<WriteResult> => {
          writes.push(handlerQn);
          return { isSuccess: true, data: {} };
        },
      },
    };
  }

  test("a manual grant that differs from the subscription is kept and reported with its own code", async () => {
    const { deps, writes } = fakeRouteDeps("pro", "starter");
    const outcome = await syncTierFromSubscription(tenantId, deps);
    expect(outcome?.code).toBe(TIER_SYNC_MANUAL_GRANT_SKIPPED);
    expect(writes).toEqual([]);
  });

  test("a manual grant equal to the subscription's tier needs no report", async () => {
    const { deps, writes } = fakeRouteDeps("pro", "pro");
    expect(await syncTierFromSubscription(tenantId, deps)).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("afterSync hook", () => {
  const tenantId = "00000000-0000-4000-8000-000000000043" as TenantId;
  const event: SubscriptionEvent = {
    kind: BillingEventKinds.subscription,
    providerEventId: "evt_1",
    providerName: "stripe",
    type: SubscriptionEventTypes.updated,
    tenantId,
    providerCustomerId: "cus_1",
    providerSubscriptionId: "sub_1",
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2030-01-01T00:00:00.000Z",
  };

  function routeDeps(assignedTier: TestTier | null) {
    const writes: string[] = [];
    return {
      writes,
      deps: {
        dispatchSystemQuery: async ({ handlerQn }: { handlerQn: string }) => {
          if (handlerQn === SubscriptionFoundationQueries.listSubscriptions) {
            return {
              rows: [
                {
                  id: subscriptionAggregateId(tenantId),
                  status: SubscriptionStatuses.active,
                  tier: "pro",
                },
              ],
            };
          }
          return {
            rows:
              assignedTier === null
                ? []
                : [
                    {
                      id: tierAssignmentAggregateId(tenantId),
                      version: 1,
                      tenantId,
                      tier: assignedTier,
                      source: TierAssignmentSources.billing,
                    },
                  ],
          };
        },
        dispatchSystemWrite: async ({ handlerQn }: { handlerQn: string }): Promise<WriteResult> => {
          writes.push(handlerQn);
          return { isSuccess: true, data: {} };
        },
      },
    };
  }

  test("an unchanged tier still calls the hook with changed: false", async () => {
    const calls: Array<{ tier: string; changed: boolean }> = [];
    const { syncAndNotify } = createSubscriptionTierSync({
      isTierName,
      defaultTier: "free",
      afterSync: async (result) => {
        calls.push({ tier: result.tier, changed: result.changed });
      },
    });
    const { deps, writes } = routeDeps("pro");

    expect(await syncAndNotify(tenantId, event, deps)).toBeNull();
    expect(calls).toEqual([{ tier: "pro", changed: false }]);
    expect(writes).toEqual([]);
  });

  test("a tier change calls the hook with changed: true", async () => {
    const calls: Array<{ tier: string; changed: boolean }> = [];
    const { syncAndNotify } = createSubscriptionTierSync({
      isTierName,
      defaultTier: "free",
      afterSync: async (result) => {
        calls.push({ tier: result.tier, changed: result.changed });
      },
    });
    const { deps, writes } = routeDeps("free");

    expect(await syncAndNotify(tenantId, event, deps)).toBeNull();
    expect(calls).toEqual([{ tier: "pro", changed: true }]);
    expect(writes).toHaveLength(1);
  });

  test("a throwing hook is reported as a sync error", async () => {
    const { syncAndNotify } = createSubscriptionTierSync({
      isTierName,
      defaultTier: "free",
      afterSync: async () => {
        throw new Error("hook broke");
      },
    });

    const error = await syncAndNotify(tenantId, event, routeDeps("pro").deps);
    expect(error).toEqual({ code: "tier_sync_after_hook_failed", message: "hook broke" });
  });
});
