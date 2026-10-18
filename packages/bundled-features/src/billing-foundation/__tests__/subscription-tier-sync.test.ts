// Unit-test for effectiveTierFromSubscription. The DB-touching half
// (syncTierFromSubscription, the wired route) is exercised via the app-level
// test suites of its two current consumers (show-pony, publicstatus) — those
// migrate onto this factory in a follow-up PR (infra#446), carrying their
// existing integration coverage with them.

import { describe, expect, test } from "bun:test";
import {
  TierAssignmentSources,
  TierEngineQueries,
  tierAssignmentAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import type { TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { SubscriptionFoundationQueries, SubscriptionStatuses } from "../constants.ts";
import {
  createSubscriptionTierSync,
  effectiveTierFromSubscription,
  TIER_SYNC_MANUAL_GRANT_SKIPPED,
} from "../subscription-tier-sync.ts";

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
