import { type ReactNode, useEffect, useId, useRef } from "react";
import {
  renderBrushBar,
  renderLegend,
  renderMarkerLegend,
  renderPlotRow,
  renderRangeSwitch,
} from "./stacked-area-chrome.tsx";
import { bucketTotals, buildStackedAreaGeometry } from "./stacked-area-geometry.ts";
import type { StackedAreaModel } from "./stacked-area-model.ts";
import { resolveStackedAreaProps, type StackedAreaChartProps } from "./stacked-area-props.ts";
import { useStackedAreaTooltip } from "./use-stacked-area-tooltip.ts";
import { useStackedAreaWindow } from "./use-stacked-area-window.ts";

export type { StackedAreaChartProps } from "./stacked-area-props.ts";

/** Stacked bands over time. Right of `todayMs` is the forecast: lighter
 *  fill plus a vertical "today" line. */
export function StackedAreaChart(rawProps: StackedAreaChartProps): ReactNode {
  const props = resolveStackedAreaProps(rawProps);
  const { scrollable, emptyContent, testId, tones, colors } = props;
  const clipId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const win = useStackedAreaWindow(props);
  const tooltip = useStackedAreaTooltip(win.times);
  const { times, todayFraction } = win;
  const bucketCount = times.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (!scrollable || el === null || bucketCount === 0) return;
    el.scrollLeft =
      todayFraction === undefined
        ? el.scrollWidth
        : Math.max(0, todayFraction * el.scrollWidth - el.clientWidth / 2);
  }, [scrollable, todayFraction, bucketCount]);

  if (times.length === 0) return <div data-testid={testId}>{emptyContent}</div>;

  const totals = bucketTotals(times, win.series);
  if (times.length === 1 && totals[0] === 0) {
    return <div data-testid={testId}>{emptyContent}</div>;
  }
  const geometry = buildStackedAreaGeometry({
    times,
    totals,
    series: win.series,
    lines: win.lines,
    markers: win.markers,
    fractionOf: win.fractionOf,
    palette: { tones, colors },
  });
  const model: StackedAreaModel = { props, clipId, win, tooltip, geometry };

  return (
    <div data-testid={testId} className="@container flex flex-col gap-3">
      {renderRangeSwitch(model)}
      {renderPlotRow(model, scrollRef)}
      {renderBrushBar(model)}
      {renderLegend(model)}
      {renderMarkerLegend(model)}
    </div>
  );
}
