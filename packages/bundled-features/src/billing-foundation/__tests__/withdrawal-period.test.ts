import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  isWithinWithdrawalPeriod,
  WITHDRAWAL_PERIOD_DAYS,
} from "../consumer-protection/withdrawal-period.ts";
import { CHECKOUT_CONSENT_RECORDED_EVENT_QN, SUBSCRIPTION_CREATED_EVENT_QN } from "../events.ts";

const START = Temporal.Instant.from("2026-10-01T10:00:00Z");

function afterStart(days: number, extraHours = 0): Temporal.Instant {
  return START.add({ hours: days * 24 + extraHours });
}

describe("isWithinWithdrawalPeriod", () => {
  const created = [{ type: SUBSCRIPTION_CREATED_EVENT_QN, createdAt: START }];

  test("is open up to and including the last moment of day 14", () => {
    expect(isWithinWithdrawalPeriod(created, afterStart(WITHDRAWAL_PERIOD_DAYS))).toBe(true);
  });

  test("is closed one hour after day 14", () => {
    expect(isWithinWithdrawalPeriod(created, afterStart(WITHDRAWAL_PERIOD_DAYS, 1))).toBe(false);
  });

  test("a later consent without a subscription start does not reopen the period", () => {
    const events = [
      ...created,
      { type: CHECKOUT_CONSENT_RECORDED_EVENT_QN, createdAt: afterStart(30) },
    ];
    expect(isWithinWithdrawalPeriod(events, afterStart(31))).toBe(false);
  });

  test("starts from the latest subscription start", () => {
    const events = [...created, { type: SUBSCRIPTION_CREATED_EVENT_QN, createdAt: afterStart(10) }];
    expect(isWithinWithdrawalPeriod(events, afterStart(20))).toBe(true);
    expect(isWithinWithdrawalPeriod(events, afterStart(25))).toBe(false);
  });

  test("ignores unrelated events and counts as expired without a start event", () => {
    const events = [{ type: "billing-foundation:event:other", createdAt: START }];
    expect(isWithinWithdrawalPeriod(events, START)).toBe(false);
  });
});
