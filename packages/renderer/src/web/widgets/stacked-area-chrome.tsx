import type { ReactNode, RefObject } from "react";
import { cn } from "../lib/cn.ts";
import { chartColor, seriesTotal, valueAt } from "./chart-data.ts";
import { MarkerLegend, markerLegendItems } from "./chart-markers.tsx";
import { ChartLegend, YTicks } from "./chart-parts.tsx";
import { ModeSwitch } from "./mode-switch.tsx";
import { StackedAreaBrush } from "./stacked-area-brush.tsx";
import { STACKED_AREA_PLOT_HEIGHT_CLASS } from "./stacked-area-geometry.ts";
import type { StackedAreaModel } from "./stacked-area-model.ts";
import { renderStackedAreaPlot } from "./stacked-area-plot.tsx";

const SCROLLABLE_BUCKET_WIDTH_PX = 48;

export function renderRangeSwitch(m: StackedAreaModel): ReactNode {
  const { ranges, ariaLabel, testId } = m.props;
  const { isControlled, selection, changeSelection } = m.win;
  if (isControlled || ranges === undefined) return undefined;
  return (
    <div className="flex justify-end">
      <ModeSwitch
        value={selection?.kind === "range" ? selection.value : null}
        options={ranges.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        onChange={(value) => changeSelection({ kind: "range", value })}
        ariaLabel={ariaLabel}
        variant="pill"
        testId={testId !== undefined ? `${testId}-range` : undefined}
      />
    </div>
  );
}

export function renderBrushBar(m: StackedAreaModel): ReactNode {
  const { brush, brushLabels, series: allSeries, testId } = m.props;
  const { allTimes, visibleWindow, changeSelection } = m.win;
  if (!brush || allTimes.length < 2) return undefined;
  return (
    <StackedAreaBrush
      times={allTimes}
      totals={allTimes.map((atMs) => allSeries.reduce((sum, s) => sum + valueAt(s, atMs), 0))}
      window={visibleWindow}
      labels={brushLabels}
      onChange={(next) =>
        changeSelection({ kind: "brush", startMs: next.startMs, endMs: next.endMs })
      }
      testId={`${testId ?? "stacked-area"}-brush`}
    />
  );
}

function renderPlotArea(
  m: StackedAreaModel,
  scrollRef: RefObject<HTMLDivElement | null>,
): ReactNode {
  const plot = renderStackedAreaPlot(m);
  if (!m.props.scrollable) return <div className="relative grow">{plot}</div>;
  return (
    <div ref={scrollRef} data-testid="chart-scroll-container" className="grow overflow-x-auto pt-4">
      <div
        data-testid="chart-scroll-content"
        className="relative"
        style={{
          minWidth: "100%",
          width: `${m.win.times.length * SCROLLABLE_BUCKET_WIDTH_PX}px`,
        }}
      >
        {plot}
      </div>
    </div>
  );
}

export function renderPlotRow(
  m: StackedAreaModel,
  scrollRef: RefObject<HTMLDivElement | null>,
): ReactNode {
  const { scrollable, formatAxisValue } = m.props;
  return (
    <div className="flex gap-2">
      <YTicks
        values={m.geometry.yTickValues}
        formatValue={formatAxisValue}
        className={cn("shrink-0 pb-0", STACKED_AREA_PLOT_HEIGHT_CLASS, scrollable && "mt-4")}
      />
      {renderPlotArea(m, scrollRef)}
    </div>
  );
}

function buildLegendItems(m: StackedAreaModel) {
  const { tones, colors, showLegendTotals, markerLegend } = m.props;
  const { series, markers } = m.win;
  return [
    ...series.map((s, i) => ({
      key: s.key,
      label: s.label,
      color: chartColor(s.key, i, tones, colors),
      ...(showLegendTotals && { total: seriesTotal(s) }),
    })),
    ...m.geometry.linePaths.map((line) => ({
      key: `line:${line.key}`,
      testIdKey: `line-${line.key}`,
      label: line.label,
      color: line.color,
      swatch: line.dashed ? ("dashed-line" as const) : ("line" as const),
    })),
    ...(markerLegend === "legend"
      ? markerLegendItems(markers ?? []).map((item) => ({
          ...item,
          swatch: "dashed-line" as const,
        }))
      : []),
  ];
}

export function renderLegend(m: StackedAreaModel): ReactNode {
  return <ChartLegend formatValue={m.props.formatValue} items={buildLegendItems(m)} />;
}

export function renderMarkerLegend(m: StackedAreaModel): ReactNode {
  const { markerLegend, markerLabels } = m.props;
  const { markers } = m.win;
  if (markers === undefined || markers.length === 0) return undefined;
  if (markerLegend !== "list" && !markerLabels) return undefined;
  return (
    <MarkerLegend
      markers={markers}
      formatMarkerTime={m.win.formatMarkerTimeInWindow}
      {...(markerLabels && { className: "@2xl:hidden" })}
    />
  );
}
