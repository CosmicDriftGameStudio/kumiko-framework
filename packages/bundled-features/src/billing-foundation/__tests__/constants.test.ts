import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  isSubscriptionBlockingCheckout,
  STALE_INCOMPLETE_AFTER,
  SubscriptionStatuses,
} from "../constants.js";

const LAST_CHANGED = Temporal.Instant.from("2024-01-01T00:00:00Z");

describe("isSubscriptionBlockingCheckout", () => {
  test("STALE_INCOMPLETE_AFTER is 24 hours", () => {
    expect(STALE_INCOMPLETE_AFTER.total("hours")).toBe(24);
  });

  test("a canceled subscription never blocks, regardless of age", () => {
    expect(
      isSubscriptionBlockingCheckout(
        { status: SubscriptionStatuses.canceled, lastChangedAt: LAST_CHANGED },
        LAST_CHANGED,
      ),
    ).toBe(false);
  });

  test("an active subscription always blocks", () => {
    expect(
      isSubscriptionBlockingCheckout(
        { status: SubscriptionStatuses.active, lastChangedAt: LAST_CHANGED },
        LAST_CHANGED.add({ hours: 1000 }),
      ),
    ).toBe(true);
  });

  test("a fresh incomplete subscription (23h59) still blocks", () => {
    const now = LAST_CHANGED.add(Temporal.Duration.from({ hours: 23, minutes: 59 }));
    expect(
      isSubscriptionBlockingCheckout(
        { status: SubscriptionStatuses.incomplete, lastChangedAt: LAST_CHANGED },
        now,
      ),
    ).toBe(true);
  });

  test("a stale incomplete subscription (24h01) no longer blocks", () => {
    const now = LAST_CHANGED.add(Temporal.Duration.from({ hours: 24, minutes: 1 }));
    expect(
      isSubscriptionBlockingCheckout(
        { status: SubscriptionStatuses.incomplete, lastChangedAt: LAST_CHANGED },
        now,
      ),
    ).toBe(false);
  });

  test("an incomplete subscription exactly at the cutoff no longer blocks", () => {
    const now = LAST_CHANGED.add(STALE_INCOMPLETE_AFTER);
    expect(
      isSubscriptionBlockingCheckout(
        { status: SubscriptionStatuses.incomplete, lastChangedAt: LAST_CHANGED },
        now,
      ),
    ).toBe(false);
  });
});
