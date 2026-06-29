import { describe, expect, test } from "bun:test";
import {
  type LedgerTxRow,
  mergeScheduleActuals,
  projectSchedule,
  type ScheduleDef,
  scheduleReference,
} from "../recurring";

// Pure projection + Soll/Ist merge — no DB, no Date API (the window/asOf are
// params), so these are deterministic and cover the recurring primitive's logic
// the integration test then proves end-to-end against a real dispatcher.

const monthly = (over: Partial<ScheduleDef> = {}): ScheduleDef => ({
  startDate: "2026-01-15",
  interval: "monthly",
  amount: 50000,
  ...over,
});

describe("projectSchedule", () => {
  test("projects one period per month across the window, clamped to startDate", () => {
    const periods = projectSchedule(monthly(), { from: "2025-11", to: "2026-04" });
    expect(periods.map((p) => p.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(periods.every((p) => p.amount === 50000)).toBe(true);
    expect(periods[0]).toEqual({ period: "2026-01", date: "2026-01-01", amount: 50000 });
  });

  test("clamps the tail to endDate (inclusive)", () => {
    const periods = projectSchedule(monthly({ endDate: "2026-03-31" }), {
      from: "2026-01",
      to: "2026-12",
    });
    expect(periods.map((p) => p.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("open-ended schedule projects to the window end", () => {
    const periods = projectSchedule(monthly(), { from: "2026-01", to: "2026-02" });
    expect(periods.map((p) => p.period)).toEqual(["2026-01", "2026-02"]);
  });

  test("window entirely before startDate yields nothing", () => {
    expect(projectSchedule(monthly(), { from: "2025-01", to: "2025-12" })).toEqual([]);
  });

  test("tolerates full ISO dates in the window bounds", () => {
    const periods = projectSchedule(monthly(), { from: "2026-02-10", to: "2026-03-05" });
    expect(periods.map((p) => p.period)).toEqual(["2026-02", "2026-03"]);
  });
});

describe("mergeScheduleActuals", () => {
  const ref = (period: string): string => scheduleReference("s1", period);
  const confirmTx = (id: string, period: string, amount = 50000): LedgerTxRow => ({
    id,
    reference: ref(period),
    lines: [
      { accountId: "bank", amount },
      { accountId: "rent", amount: -amount },
    ],
  });

  const projection = projectSchedule(monthly(), { from: "2026-01", to: "2026-04" });

  test("posted for a confirmed month, open for past-unbooked, forecast for future", () => {
    const months = mergeScheduleActuals(
      "s1",
      projection,
      [confirmTx("tx-jan", "2026-01")],
      "2026-03",
    );
    expect(months.map((m) => [m.period, m.status])).toEqual([
      ["2026-01", "posted"],
      ["2026-02", "open"],
      ["2026-03", "open"],
      ["2026-04", "forecast"],
    ]);
    const jan = months[0];
    expect(jan).toMatchObject({ planned: 50000, actual: 50000, txId: "tx-jan" });
    expect(months[1]).toMatchObject({ actual: null, txId: null });
  });

  test("a reversed (stornoed) confirmation drops the month back to open + re-confirmable", () => {
    const tx: LedgerTxRow[] = [
      confirmTx("tx-jan", "2026-01"),
      // Storno mirror: references the confirming tx's id (reverse-transaction shape).
      {
        id: "tx-storno",
        reference: "tx-jan",
        lines: [
          { accountId: "bank", amount: -50000 },
          { accountId: "rent", amount: 50000 },
        ],
      },
    ];
    const months = mergeScheduleActuals("s1", projection, tx, "2026-03");
    expect(months[0]).toMatchObject({
      period: "2026-01",
      status: "open",
      actual: null,
      txId: null,
    });
  });

  test("a re-confirmation after Storno posts again with the new tx", () => {
    const tx: LedgerTxRow[] = [
      confirmTx("tx-jan", "2026-01"),
      {
        id: "tx-storno",
        reference: "tx-jan",
        lines: [
          { accountId: "bank", amount: -50000 },
          { accountId: "rent", amount: 50000 },
        ],
      },
      confirmTx("tx-jan-2", "2026-01", 48000), // re-confirmed, came in short
    ];
    const months = mergeScheduleActuals("s1", projection, tx, "2026-03");
    expect(months[0]).toMatchObject({ status: "posted", actual: 48000, txId: "tx-jan-2" });
  });

  test("ignores transactions of other schedules", () => {
    const tx: LedgerTxRow[] = [
      {
        id: "tx-other",
        reference: scheduleReference("s2", "2026-01"),
        lines: [
          { accountId: "bank", amount: 50000 },
          { accountId: "rent", amount: -50000 },
        ],
      },
    ];
    const months = mergeScheduleActuals("s1", projection, tx, "2026-03");
    expect(months[0]).toMatchObject({ status: "open", txId: null });
  });
});
