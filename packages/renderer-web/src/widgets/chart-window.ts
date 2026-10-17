// Pure window math for StackedAreaChart: range presets anchored at today and
// brush selections snapped to bucket times.

import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export type ChartWindow = { readonly startMs: number; readonly endMs: number };

export type StackedAreaRangeOption = {
  readonly value: string;
  /** Translated by the caller. */
  readonly label: string;
  /** Window length in months; omitted shows the full window. */
  readonly months?: number;
};

export type StackedAreaRanges = {
  readonly options: readonly StackedAreaRangeOption[];
  readonly default: string;
};

export type StackedAreaWindowSelection =
  | { readonly kind: "range"; readonly value: string }
  | { readonly kind: "brush"; readonly startMs: number; readonly endMs: number }
  | { readonly kind: "from-today" };

export type StackedAreaInitialWindow = "default-range" | "from-today";

export type StackedAreaDateFormat = "day" | "month";

const MONTH_FORMAT_MIN_SPAN_MONTHS = 18;

export function stackedAreaDateFormatFor(window: ChartWindow): StackedAreaDateFormat {
  return window.endMs >= addUtcMonths(window.startMs, MONTH_FORMAT_MIN_SPAN_MONTHS)
    ? "month"
    : "day";
}

export function addUtcMonths(atMs: number, months: number): number {
  return Temporal.Instant.fromEpochMilliseconds(atMs).toZonedDateTimeISO("UTC").add({ months })
    .epochMilliseconds;
}

// Same window as a "1/3/5 years" switch over a plan: `months` ahead of today,
// pulled back when the data ends earlier, never before the first bucket.
export function rangeWindow(
  months: number,
  anchorMs: number,
  firstMs: number,
  lastMs: number,
): ChartWindow {
  const endMs = Math.min(lastMs, addUtcMonths(anchorMs, months));
  return { startMs: Math.max(firstMs, addUtcMonths(endMs, -months)), endMs };
}

export function pointsWithin<T extends { readonly atMs: number }>(
  points: readonly T[],
  window: ChartWindow,
): readonly T[] {
  return points.filter((p) => p.atMs >= window.startMs && p.atMs <= window.endMs);
}

export function initialWindowSelection(
  ranges: StackedAreaRanges | undefined,
  initialWindow: StackedAreaInitialWindow = "default-range",
): StackedAreaWindowSelection | undefined {
  if (initialWindow === "from-today") return { kind: "from-today" };
  return ranges === undefined ? undefined : { kind: "range", value: ranges.default };
}

function clampMs(value: number, minMs: number, maxMs: number): number {
  return Math.max(minMs, Math.min(maxMs, value));
}

function windowFromToday(
  todayMs: number | undefined,
  firstMs: number,
  lastMs: number,
  fullWindow: ChartWindow,
): ChartWindow {
  if (todayMs === undefined || todayMs >= lastMs) return fullWindow;
  return { startMs: clampMs(todayMs, firstMs, lastMs), endMs: lastMs };
}

export function resolveStackedAreaWindow({
  selection,
  ranges,
  brush,
  todayMs,
  bucketTimes,
  fullWindow,
}: {
  readonly selection: StackedAreaWindowSelection | undefined;
  readonly ranges: StackedAreaRanges | undefined;
  readonly brush: boolean;
  readonly todayMs: number | undefined;
  /** Sorted ascending. */
  readonly bucketTimes: readonly number[];
  readonly fullWindow: ChartWindow;
}): ChartWindow {
  const firstMs = bucketTimes[0];
  const lastMs = bucketTimes[bucketTimes.length - 1];
  if (firstMs === undefined || lastMs === undefined) return fullWindow;

  if (selection?.kind === "brush") {
    const startMs = clampMs(Math.min(selection.startMs, selection.endMs), firstMs, lastMs);
    const endMs = clampMs(Math.max(selection.startMs, selection.endMs), firstMs, lastMs);
    return { startMs, endMs };
  }
  if (selection?.kind === "range") {
    const months = ranges?.options.find((option) => option.value === selection.value)?.months;
    if (months === undefined) return fullWindow;
    return rangeWindow(months, todayMs ?? lastMs, firstMs, lastMs);
  }
  if (selection?.kind === "from-today" || (brush && ranges === undefined)) {
    return windowFromToday(todayMs, firstMs, lastMs, fullWindow);
  }
  return fullWindow;
}

/** Bucket closest to a horizontal position given as a 0..1 fraction of the window. */
export function bucketIndexAtFraction(
  times: readonly number[],
  window: ChartWindow,
  fraction: number,
): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return nearestIndex(times, window.startMs + clamped * (window.endMs - window.startMs));
}

export function nearestIndex(times: readonly number[], atMs: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    const current = times[i];
    const bestTime = times[best];
    if (current === undefined || bestTime === undefined) continue;
    if (Math.abs(current - atMs) < Math.abs(bestTime - atMs)) best = i;
  }
  return best;
}

/** Snaps a brush drag to bucket times, keeping start < end by at least one
 *  bucket; `anchor` is the edge the user holds and therefore stays put. */
export function snapBrushWindow(
  times: readonly number[],
  startMs: number,
  endMs: number,
  anchor: "start" | "end" = "start",
): ChartWindow {
  const lastIndex = times.length - 1;
  if (lastIndex < 1) return { startMs, endMs };
  let startIndex = nearestIndex(times, Math.min(startMs, endMs));
  let endIndex = nearestIndex(times, Math.max(startMs, endMs));
  if (endIndex <= startIndex) {
    if (anchor === "start") {
      endIndex = Math.min(lastIndex, startIndex + 1);
      startIndex = endIndex - 1;
    } else {
      startIndex = Math.max(0, endIndex - 1);
      endIndex = startIndex + 1;
    }
  }
  return { startMs: times[startIndex] ?? startMs, endMs: times[endIndex] ?? endMs };
}

const MONTH_TICK_STEPS = [1, 2, 3, 6, 12, 24, 36, 60, 120] as const;
const DAY_TICK_STEPS = [1, 2, 7, 14] as const;
const DAY_MS = 86_400_000;

function monthTicks(window: ChartWindow, step: number, timeZone: string): readonly number[] {
  const startOfMonth = Temporal.Instant.fromEpochMilliseconds(window.startMs)
    .toZonedDateTimeISO(timeZone)
    .startOfDay()
    .with({ day: 1 });
  const ticks: number[] = [];
  for (let cursor = startOfMonth; ; cursor = cursor.add({ months: 1 })) {
    const atMs = cursor.epochMilliseconds;
    if (atMs >= window.endMs) break;
    if (atMs > window.startMs && (cursor.year * 12 + cursor.month - 1) % step === 0) {
      ticks.push(atMs);
    }
  }
  return ticks;
}

// Local day starts: DST days are not 24h, so the cursor advances by calendar
// day. The step phase uses the local day number, not epoch-ms modulo.
function dayTicks(window: ChartWindow, step: number, timeZone: string): readonly number[] {
  const ticks: number[] = [];
  const firstDay = Temporal.Instant.fromEpochMilliseconds(window.startMs)
    .toZonedDateTimeISO(timeZone)
    .startOfDay();
  for (let cursor = firstDay; ; cursor = cursor.add({ days: 1 }).startOfDay()) {
    const atMs = cursor.epochMilliseconds;
    if (atMs >= window.endMs) break;
    const localDayNumber = Math.round((atMs + cursor.offsetNanoseconds / 1e6) / DAY_MS);
    if (atMs > window.startMs && localDayNumber % step === 0) ticks.push(atMs);
  }
  return ticks;
}

function hasRoomBetweenLabels(
  window: ChartWindow,
  ticks: readonly number[],
  slotMs: number,
): boolean {
  const positions = [window.startMs, ...ticks, window.endMs];
  return positions.every((atMs, i) => i === 0 || atMs - (positions[i - 1] ?? atMs) >= slotMs);
}

function thinToSlots(
  window: ChartWindow,
  ticks: readonly number[],
  slotMs: number,
): readonly number[] {
  const kept: number[] = [];
  let previous = window.startMs;
  for (const atMs of ticks) {
    if (atMs - previous >= slotMs && window.endMs - atMs >= slotMs) {
      kept.push(atMs);
      previous = atMs;
    }
  }
  return kept;
}

// Start/end labels are edge-aligned (a full label width inward) while inner
// ticks are centred, so the edge gap needs 1.5 slots for the same clearance.
const EDGE_GAP_SLOTS = 1.5;

/** Calendar-aligned tick times (month/day starts in `timeZone`, default UTC)
 *  strictly inside the window: the smallest
 *  step whose inner ticks fit `maxLabels - 2`, keep one label slot
 *  (`span / maxLabels`) between inner neighbours and `EDGE_GAP_SLOTS` to the
 *  start/end labels. If no step fits, the coarsest one is thinned greedily. */
export function stackedAreaAxisTicks(
  window: ChartWindow,
  maxLabels: number,
  format: StackedAreaDateFormat,
  timeZone = "UTC",
): readonly number[] {
  const span = window.endMs - window.startMs;
  if (span <= 0) return [];
  const slotMs = span / maxLabels;
  const edgeGapMs = slotMs * EDGE_GAP_SLOTS;
  const innerBudget = Math.max(0, maxLabels - 2);
  const candidates: readonly (() => readonly number[])[] = [
    ...(format === "day"
      ? DAY_TICK_STEPS.map((step) => () => dayTicks(window, step, timeZone))
      : []),
    ...MONTH_TICK_STEPS.map((step) => () => monthTicks(window, step, timeZone)),
  ];
  let ticks: readonly number[] = [];
  for (const candidate of candidates) {
    ticks = candidate().filter(
      (atMs) => atMs - window.startMs >= edgeGapMs && window.endMs - atMs >= edgeGapMs,
    );
    if (ticks.length <= innerBudget && hasRoomBetweenLabels(window, ticks, slotMs)) return ticks;
  }
  return thinToSlots(window, ticks, slotMs).slice(0, innerBudget);
}
