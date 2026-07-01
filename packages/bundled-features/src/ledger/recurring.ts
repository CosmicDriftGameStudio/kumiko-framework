// Recurring schedules on top of the ledger primitive. A `schedule` is a standing
// booking template ("Miete ab 1.1.2026, 500 €/Monat") from which two things fall
// out WITHOUT booking every month up front:
//
//   • projectSchedule()      — the Soll (forecast): pure projection over a window,
//                              no transactions needed (chart, "trägt sich das?").
//   • mergeScheduleActuals() — Soll vs. Ist: the projection left-joined against
//                              the posted confirmations (per `reference`), so each
//                              month is posted | open | forecast.
//
// confirm-schedule-period (handler) turns one projected month into ONE balanced
// transaction tagged with `scheduleReference(id, period)`. Both functions here are
// pure — no DB, no Date API (windows/asOf come in as params) — so the no-date-api
// guard stays green and the forecast is deterministic.

import type { ScheduleInterval } from "./constants";
import type { Posting } from "./schemas";

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
  readonly reference: string | null;
  readonly lines: readonly Posting[];
};

// "schedule:<id>:<period>" — the stable idempotency + merge key on a confirmation.
export function scheduleReference(scheduleId: string, period: string): string {
  return `schedule:${scheduleId}:${period}`;
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

// Soll vs. Ist. A month is `posted` when a confirmation for its reference exists
// AND has not been reversed (Storno); a reversed confirmation drops the month back
// to `open` so it can be re-confirmed. Past/current unbooked months are `open`,
// future ones `forecast` (asOf is the boundary — month-granular).
export function mergeScheduleActuals(
  scheduleId: string,
  projection: readonly ProjectedPeriod[],
  transactions: readonly LedgerTxRow[],
  asOf: string,
): ScheduleMonth[] {
  const txIds = new Set(transactions.map((t) => t.id));
  // A Storno mirror carries reference = the reversed tx's id, so any tx whose
  // reference names another tx marks that other tx reversed.
  const reversedTxIds = new Set(
    transactions
      .filter((t) => t.reference != null && txIds.has(t.reference))
      .map((t) => t.reference as string),
  );
  const asOfIndex = monthIndex(isoMonth(asOf));

  return projection.map((projected) => {
    const reference = scheduleReference(scheduleId, projected.period);
    const active = transactions.find((t) => t.reference === reference && !reversedTxIds.has(t.id));
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
