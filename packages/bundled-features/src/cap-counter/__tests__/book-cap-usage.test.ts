import { describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { bookCapUsage, markCapSoftWarned, readRollingCapUsage } from "../book-cap-usage.ts";
import { ROLLING_INCREMENTED_EVENT_QN, ROLLING_RELEASED_EVENT_QN } from "../constants.ts";

// Input validation runs before any ctx access, so an empty ctx proves nothing is written.
const untouchedCtx = {} as HandlerContext; // @cast-boundary test-stub

describe.each([
  ["bookCapUsage", bookCapUsage],
  ["markCapSoftWarned", markCapSoftWarned],
])("%s period validation", (_name, run) => {
  test.each(["not-a-date", "2026-05-01", ""])(
    "rejects periodStartIso %p",
    async (periodStartIso) => {
      await expect(run(untouchedCtx, { capName: "cap", periodStartIso })).rejects.toThrow();
    },
  );
});

describe("readRollingCapUsage", () => {
  type StoredEvent = { type: string; payload: Record<string, unknown> };

  function usageOver(events: readonly StoredEvent[]): Promise<number> {
    const db = {
      selectMany: async (_table: unknown, where: { type: string }) =>
        events.filter((event) => event.type === where.type),
    };
    return readRollingCapUsage(db as unknown as TenantDb, "tenant" as TenantId, {
      capName: "cap",
      windowDays: 1,
    });
  }

  const hoursAgo = (hours: number) => Temporal.Now.instant().subtract({ hours }).toString();

  test("a release whose increment left the window does not reduce usage of increments inside it", async () => {
    const usage = await usageOver([
      { type: ROLLING_INCREMENTED_EVENT_QN, payload: { amount: 5 } },
      {
        type: ROLLING_RELEASED_EVENT_QN,
        payload: { amount: 3, incrementedAt: hoursAgo(25) },
      },
    ]);

    expect(usage).toBe(5);
  });

  test("a release whose increment is inside the window is subtracted", async () => {
    const usage = await usageOver([
      { type: ROLLING_INCREMENTED_EVENT_QN, payload: { amount: 5 } },
      {
        type: ROLLING_RELEASED_EVENT_QN,
        payload: { amount: 3, incrementedAt: hoursAgo(2) },
      },
    ]);

    expect(usage).toBe(2);
  });

  test("a legacy release without incrementedAt is subtracted", async () => {
    const usage = await usageOver([
      { type: ROLLING_INCREMENTED_EVENT_QN, payload: { amount: 5 } },
      { type: ROLLING_RELEASED_EVENT_QN, payload: { amount: 3 } },
    ]);

    expect(usage).toBe(2);
  });
});
