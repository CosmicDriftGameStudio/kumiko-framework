// Unit-test for effectiveTierFromSubscription. The DB-touching half
// (syncTierFromSubscription, the wired route) is exercised via the app-level
// test suites of its two current consumers (show-pony, publicstatus) — those
// migrate onto this factory in a follow-up PR (infra#446), carrying their
// existing integration coverage with them.

import { describe, expect, test } from "bun:test";
import { SubscriptionStatuses } from "../constants";
import { effectiveTierFromSubscription } from "../subscription-tier-sync";

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
