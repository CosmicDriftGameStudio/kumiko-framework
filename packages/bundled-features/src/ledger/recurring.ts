// Recurring schedules on top of the ledger primitive. A `schedule` is a standing
// booking template ("Rent from 1/1/2026, €500/month") used without booking every
// month up front:
//
//   • projectSchedule()      — the forecast: a pure projection over a window with
//                              no transactions required (chart, "does it pay for itself?").
//   • mergeScheduleActuals() — forecast vs. actual: the projection left-joined
//                              against posted confirmations (by the scheduleId +
//                              period columns), so each month is posted | open | forecast.
//
// The confirm-schedule-period handler turns one projected month into one balanced
// transaction carrying scheduleId + period; a Storno carries reversesTransactionId
// and copies scheduleId/period. Both functions here are
// pure—no DB or Date API (windows/asOf are supplied as parameters)—so the forecast
// remains deterministic and the no-date-api guard stays green.

import type { Posting } from "./schemas.ts";
import type { ScheduleInterval } from "./web/constants.ts";

export type ScheduleDef = {
  readonly startDate: string; // ISO; first period (day ignored for monthly)
  readonly endDate?: string | null; // ISO; last period inclusive, or open-ended
  readonly interval: ScheduleInterval;
  readonly amount: number; // positive minor units; the handler assigns debit/credit signs
};

export type ProjectedPeriod = {
  readonly period: string; // "YYYY-MM"
  readonly date: string; // ISO booking date (first of the period month)
  readonly amount: number;
};

export type ScheduleMonthStatus = "posted" | "open" | "forecast";

export type ScheduleMonth = {
  readonly period: string;
  readonly planned: number; // Soll from the schedule
  readonly actual: number | null; // Ist (booked) or null
  readonly txId: string | null; // the confirming transaction, for un-confirm (Storno)
  readonly status: ScheduleMonthStatus;
};

// The transaction shape the host feeds the merge (transaction:list rows with the
// jsonb `lines` already parsed — driver-normalised, like the integration test's
// linesOf helper).
export type LedgerTxRow = {
  readonly id: string;
  readonly scheduleId: string | null;
  readonly period: string | null;
  readonly reversesTransactionId: string | null;
  readonly lines: readonly Posting[];
};

// A Storno carries reversesTransactionId = the reversed tx's id. Shared by
// mergeScheduleActuals (below) and confirm-schedule-period.write.ts's
// idempotency check, kept in one place so a fix can't land in one call-site only.
export function findReversedIds(
  rows: readonly { readonly reversesTransactionId: string | null }[],
): Set<string> {
  return new Set(
    rows.flatMap((r) => (r.reversesTransactionId !== null ? [r.reversesTransactionId] : [])),
  );
}

// "YYYY-MM" ⇄ a month index (year*12 + monthOfYear), so window math is pure
// integer arithmetic — no Date object (no-date-api guard) and no DST/timezone
// drift. isoMonth tolerates a full ISO date ("2026-01-15" → "2026-01").
export function isoMonth(iso: string): string {
  return iso.slice(0, 7);
}

function monthIndex(ym: string): number {
  const [y, m] = ym.split("-");
  return Number(y) * 12 + (Number(m) - 1);
}

// guard:dup-ok ledger month key YYYY-MM; look-alike month-index helpers return other formats
function indexToMonth(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

// The Soll: every period the schedule covers within [window.from, window.to],
// clamped to the schedule's own [startDate, endDate]. Monthly only in v1.
// ponytail: monthly-only; add weekly/quarterly/yearly to the interval union +
// the step here when a schedule needs it.
export function projectSchedule(
  schedule: ScheduleDef,
  window: { readonly from: string; readonly to: string },
): ProjectedPeriod[] {
  const firstIndex = Math.max(
    monthIndex(isoMonth(schedule.startDate)),
    monthIndex(isoMonth(window.from)),
  );
  const lastIndex = Math.min(
    schedule.endDate != null ? monthIndex(isoMonth(schedule.endDate)) : Number.POSITIVE_INFINITY,
    monthIndex(isoMonth(window.to)),
  );
  const periods: ProjectedPeriod[] = [];
  for (let index = firstIndex; index <= lastIndex; index++) {
    const period = indexToMonth(index);
    periods.push({ period, date: `${period}-01`, amount: schedule.amount });
  }
  return periods;
}

// Planned vs. actual. A month is `posted` when a confirmation for its scheduleId + period exists
// AND has not been reversed; a reversed confirmation drops the month back
// to `open` so it can be re-confirmed. Past/current unbooked months are `open`,
// future ones `forecast` (asOf is the boundary — month-granular).
export function mergeScheduleActuals(
  scheduleId: string,
  projection: readonly ProjectedPeriod[],
  transactions: readonly LedgerTxRow[],
  asOf: string,
): ScheduleMonth[] {
  const reversed = findReversedIds(transactions);
  const asOfIndex = monthIndex(isoMonth(asOf));

  return projection.map((projected) => {
    const active = transactions.find(
      (t) =>
        t.scheduleId === scheduleId &&
        t.period === projected.period &&
        t.reversesTransactionId === null &&
        !reversed.has(t.id),
    );
    if (active) {
      return {
        period: projected.period,
        planned: projected.amount,
        actual: Math.abs(active.lines[0]?.amount ?? 0),
        txId: active.id,
        status: "posted",
      };
    }
    const status: ScheduleMonthStatus =
      monthIndex(projected.period) <= asOfIndex ? "open" : "forecast";
    return {
      period: projected.period,
      planned: projected.amount,
      actual: null,
      txId: null,
      status,
    };
  });
}
