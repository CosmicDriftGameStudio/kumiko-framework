import { useMemo, useState } from "react";
import { bucketTimes } from "./chart-data.ts";
import {
  type ChartWindow,
  initialWindowSelection,
  pointsWithin,
  resolveStackedAreaWindow,
  type StackedAreaWindowSelection,
  stackedAreaAxisTicks,
  stackedAreaDateFormatFor,
} from "./chart-window.ts";
import { AXIS_TIERS } from "./stacked-area-geometry.ts";
import type { ResolvedStackedAreaProps } from "./stacked-area-props.ts";

function resolveVisibleWindow(
  props: ResolvedStackedAreaProps,
  selection: StackedAreaWindowSelection | undefined,
  allTimes: readonly number[],
): ChartWindow {
  const { ranges, brush, todayMs } = props;
  const fullWindow: ChartWindow = { startMs: props.windowStartMs, endMs: props.windowEndMs };
  const isWindowing = ranges !== undefined || brush || selection !== undefined;
  if (!isWindowing) return fullWindow;
  return resolveStackedAreaWindow({
    selection,
    ranges,
    brush,
    todayMs,
    bucketTimes: allTimes,
    fullWindow,
  });
}

function restrictToWindow(props: ResolvedStackedAreaProps, visibleWindow: ChartWindow) {
  const { series: allSeries, lines: allLines, markers: allMarkers } = props;
  const isNarrowed =
    visibleWindow.startMs !== props.windowStartMs || visibleWindow.endMs !== props.windowEndMs;
  if (!isNarrowed) return { series: allSeries, lines: allLines, markers: allMarkers };
  return {
    series: allSeries.map((s) => ({ ...s, points: pointsWithin(s.points, visibleWindow) })),
    lines: allLines.map((line) => ({ ...line, points: pointsWithin(line.points, visibleWindow) })),
    markers: allMarkers !== undefined ? pointsWithin(allMarkers, visibleWindow) : allMarkers,
  };
}

export function useStackedAreaWindow(props: ResolvedStackedAreaProps) {
  const { ranges, initialWindow, windowSelection, onWindowSelectionChange } = props;
  const { dateFormat, timeZone, formatBucketLabel, formatMarkerTime, todayMs } = props;
  const [internalSelection, setInternalSelection] = useState(
    initialWindowSelection(ranges, initialWindow),
  );
  const isControlled = onWindowSelectionChange !== undefined;
  const selection = isControlled ? windowSelection : internalSelection;
  const changeSelection = (next: StackedAreaWindowSelection): void => {
    if (isControlled) onWindowSelectionChange(next);
    else setInternalSelection(next);
  };
  const allTimes = bucketTimes([...props.series, ...props.lines]);
  const visibleWindow = resolveVisibleWindow(props, selection, allTimes);
  const windowStartMs = visibleWindow.startMs;
  const windowEndMs = visibleWindow.endMs;
  const effectiveDateFormat = dateFormat ?? stackedAreaDateFormatFor(visibleWindow);
  const formatBucket = (atMs: number): string => formatBucketLabel(atMs, effectiveDateFormat);
  const tierTicks = useMemo(
    () =>
      AXIS_TIERS.map((tier) =>
        stackedAreaAxisTicks(
          { startMs: windowStartMs, endMs: windowEndMs },
          tier.maxLabels,
          effectiveDateFormat,
          timeZone,
        ),
      ),
    [windowStartMs, windowEndMs, effectiveDateFormat, timeZone],
  );
  const formatMarkerTimeInWindow =
    formatMarkerTime === undefined
      ? undefined
      : (atMs: number): string => formatMarkerTime(atMs, effectiveDateFormat);
  const { series, lines, markers } = restrictToWindow(props, visibleWindow);
  const times = bucketTimes([...series, ...lines]);
  const span = Math.max(1, windowEndMs - windowStartMs);
  const fractionOf = (atMs: number): number =>
    Math.max(0, Math.min(1, (atMs - windowStartMs) / span));
  const todayFraction = todayMs !== undefined ? fractionOf(todayMs) : undefined;
  return {
    isControlled,
    selection,
    changeSelection,
    allTimes,
    visibleWindow,
    windowStartMs,
    windowEndMs,
    formatBucket,
    tierTicks,
    formatMarkerTimeInWindow,
    series,
    lines,
    markers,
    times,
    fractionOf,
    todayFraction,
  };
}
