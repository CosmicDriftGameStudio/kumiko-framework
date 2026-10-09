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
