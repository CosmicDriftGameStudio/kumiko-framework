import { type CSSProperties, type HTMLAttributes, type ReactNode, useState } from "react";
import { cn } from "../lib/cn.ts";
import { type ColorMap, chartColor, chartToneColor } from "./chart-data.ts";
import { ChartLegend } from "./chart-parts.tsx";
import { niceTicks } from "./chart-scale.ts";

// Inline SVG charts for numeric axes (years, euros, correlations) without a chart dependency.
// Same layout as TimeseriesChart: the SVG scales to its box, axis labels sit in HTML so they
// never stretch; percentages position everything outside the SVG.

const VIEW_WIDTH = 300;
const DEFAULT_HEIGHT = 192;
const GUTTER_CLASS = "w-12 shrink-0";
const MAX_X_LABELS = 8;

export type NumericPoint = { readonly x: number; readonly y: number };
export type NumericAxis = {
  readonly ticks: number;
  readonly format?: (value: number) => string;
};
export type NumericReferenceLine = {
  readonly axis: "x" | "y";
  readonly value: number;
  readonly label?: string;
  readonly dashed?: boolean;
};

export type NumericDomain = { readonly min: number; readonly max: number };

function rangeOf(values: readonly number[]): NumericDomain {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = values[0] ?? 0;
  let max = min;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function extentOfTicks(ticks: readonly number[]): NumericDomain {
  return { min: ticks[0] ?? 0, max: ticks[ticks.length - 1] ?? 1 };
}

// 0..1 from the extent's min; a flat extent maps to 0 instead of dividing by zero.
function share(extent: NumericDomain, value: number): number {
  const span = extent.max - extent.min;
  return span === 0 ? 0 : (value - extent.min) / span;
}

function formatterOf(axis: {
  readonly format?: (value: number) => string;
}): (value: number) => string {
  return axis.format ?? String;
}

type AxisLabel = { readonly label: string; readonly position: number };

type PlotFrameProps = {
  readonly height: number;
  readonly ariaLabel: string;
  readonly testId: string | undefined;
  // position: 0..1 from the top
  readonly yLabels: readonly AxisLabel[];
  // position: 0..1 from the left
  readonly xLabels: readonly AxisLabel[];
  readonly plotHandlers?: Pick<HTMLAttributes<HTMLDivElement>, "onPointerMove" | "onPointerLeave">;
  readonly overlay?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
};

function PlotFrame({
  height,
  ariaLabel,
  testId,
  yLabels,
  xLabels,
  plotHandlers,
  overlay,
  footer,
  children,
}: PlotFrameProps): ReactNode {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex gap-2">
        <div
          aria-hidden="true"
          className={cn(
            "relative text-right text-[11px] tabular-nums text-muted-foreground",
            GUTTER_CLASS,
          )}
          style={{ height }}
        >
          {yLabels.map((tick) => (
            <span
              key={tick.position}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${tick.position * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" {...plotHandlers}>
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
            preserveAspectRatio="none"
            className="block w-full"
            style={{ height }}
            role="img"
            aria-label={ariaLabel}
          >
            <title>{ariaLabel}</title>
            {yLabels.map((tick) => (
              <line
                key={tick.position}
                data-grid-line=""
                x1={0}
                x2={VIEW_WIDTH}
                y1={tick.position * height}
                y2={tick.position * height}
                stroke="var(--color-border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {children}
          </svg>
          {overlay}
        </div>
      </div>
      <div className="flex gap-2">
        <div className={GUTTER_CLASS} />
        <div
          aria-hidden="true"
          className="relative h-4 min-w-0 flex-1 text-[11px] tabular-nums text-muted-foreground"
        >
          {xLabels.map((tick) => (
            <span
              key={tick.position}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${tick.position * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {footer}
    </div>
  );
}

function ReferenceLabel({
  label,
  className,
  style,
}: {
  readonly label: string;
  readonly className?: string;
  readonly style: CSSProperties;
}): ReactNode {
  return (
    <span
      className={cn(
        "pointer-events-none absolute rounded bg-background/80 px-1 text-[11px] text-muted-foreground",
        className,
      )}
      style={style}
    >
      {label}
    </span>
  );
}

function nearestValue(values: readonly number[], target: number): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (best === undefined || Math.abs(value - target) < Math.abs(best - target)) best = value;
  }
  return best;
}

export type NumericLineSeries = {
  readonly key: string;
  readonly label: string;
  readonly points: readonly NumericPoint[];
  readonly dashed?: boolean;
};

export type NumericLineChartProps = {
  readonly series: readonly NumericLineSeries[];
  readonly xAxis: NumericAxis & { readonly domain?: NumericDomain };
  readonly yAxis: NumericAxis;
  readonly referenceLines?: readonly NumericReferenceLine[];
  readonly colors?: ColorMap;
  /** Content of the hover box for the x value nearest to the pointer. */
  readonly renderTooltip?: (x: number) => ReactNode;
  readonly ariaLabel: string;
  /** Plot height in px. Default: 192. */
  readonly height?: number;
  readonly testId?: string;
};

/** Lines over a numeric x axis (e.g. years) with y ticks, reference lines and a hover tooltip. */
export function NumericLineChart({
  series,
  xAxis,
  yAxis,
  referenceLines = [],
  colors,
  renderTooltip,
  ariaLabel,
  height = DEFAULT_HEIGHT,
  testId,
}: NumericLineChartProps): ReactNode {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const allX = series.flatMap((line) => line.points.map((point) => point.x));
  const xDomain = xAxis.domain ?? rangeOf(allX);
  const xTicks = niceTicks(xDomain.min, xDomain.max, xAxis.ticks).filter(
    (tick) => tick >= xDomain.min && tick <= xDomain.max,
  );
  const yReferenceValues = referenceLines
    .filter((line) => line.axis === "y")
    .map((line) => line.value);
  const yData = rangeOf([
    0,
    ...series.flatMap((line) => line.points.map((point) => point.y)),
    ...yReferenceValues,
  ]);
  const yTicks = niceTicks(Math.min(0, yData.min), yData.max, yAxis.ticks);
  const yExtent = extentOfTicks(yTicks);
  const xOf = (x: number): number => share(xDomain, x) * VIEW_WIDTH;
  const yOf = (y: number): number => (1 - share(yExtent, y)) * height;
  const formatX = formatterOf(xAxis);
  const formatY = formatterOf(yAxis);
  const drawableReferences = referenceLines.filter(
    (line) => line.axis === "y" || (line.value >= xDomain.min && line.value <= xDomain.max),
  );

  return (
    <PlotFrame
      height={height}
      ariaLabel={ariaLabel}
      testId={testId}
      yLabels={yTicks.map((tick) => ({
        label: formatY(tick),
        position: 1 - share(yExtent, tick),
      }))}
      xLabels={xTicks.map((tick) => ({ label: formatX(tick), position: share(xDomain, tick) }))}
      plotHandlers={{
        onPointerMove: (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const fraction =
            rect.width > 0
              ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
              : 0;
          const nearest = nearestValue(allX, xDomain.min + fraction * (xDomain.max - xDomain.min));
          if (nearest !== undefined) setHoverX(nearest);
        },
        onPointerLeave: () => setHoverX(null),
      }}
      overlay={
        <>
          {drawableReferences.map((line) =>
            line.label === undefined ? null : (
              <ReferenceLabel
                key={`${line.axis}:${line.value}`}
                label={line.label}
                className={line.axis === "y" ? "right-0 -translate-y-full" : "top-0"}
                style={
                  line.axis === "y"
                    ? { top: `${(yOf(line.value) / height) * 100}%` }
                    : { left: `${share(xDomain, line.value) * 100}%` }
                }
              />
            ),
          )}
          {hoverX !== null && renderTooltip !== undefined && (
            <div
              data-testid="numeric-tooltip"
              className="pointer-events-none absolute top-0 z-10 rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow"
              style={{
                left: `${share(xDomain, hoverX) * 100}%`,
                transform: share(xDomain, hoverX) > 0.5 ? "translateX(-100%)" : undefined,
              }}
            >
              {renderTooltip(hoverX)}
            </div>
          )}
        </>
      }
      footer={
        <ChartLegend
          formatValue={String}
          items={series.map((line, index) => ({
            key: line.key,
            label: line.label,
            color: chartColor(line.key, index, undefined, colors),
            swatch: line.dashed === true ? "dashed-line" : "line",
          }))}
        />
      }
    >
      {drawableReferences.map((line) => (
        <line
          key={`${line.axis}:${line.value}`}
          data-testid={`numeric-reference-${line.axis}`}
          x1={line.axis === "x" ? xOf(line.value) : 0}
          x2={line.axis === "x" ? xOf(line.value) : VIEW_WIDTH}
          y1={line.axis === "y" ? yOf(line.value) : 0}
          y2={line.axis === "y" ? yOf(line.value) : height}
          stroke="var(--color-muted-foreground)"
          strokeWidth={1}
          strokeDasharray={line.dashed === true ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {series.map((line, index) => (
        <path
          key={line.key}
          data-testid={`numeric-line-${line.key}`}
          d={[...line.points]
            .sort((a, b) => a.x - b.x)
            .map(
              (point, i) =>
                `${i === 0 ? "M" : "L"} ${xOf(point.x).toFixed(1)} ${yOf(point.y).toFixed(1)}`,
            )
            .join(" ")}
          fill="none"
          stroke={chartColor(line.key, index, undefined, colors)}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeDasharray={line.dashed === true ? "5 4" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hoverX !== null && (
        <line
          data-testid="numeric-hover-line"
          x1={xOf(hoverX)}
          x2={xOf(hoverX)}
          y1={0}
          y2={height}
          stroke="var(--color-muted-foreground)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </PlotFrame>
  );
}

export type SignedBarBucket = {
  readonly x: number;
  readonly values: Readonly<Record<string, number>>;
};

export type SignedBarChartProps = {
  readonly buckets: readonly SignedBarBucket[];
  readonly series: readonly { readonly key: string; readonly label: string }[];
  readonly xAxis: { readonly format: (x: number) => string };
  readonly yAxis: NumericAxis;
  readonly colors?: ColorMap;
  readonly formatValue?: (value: number) => string;
  readonly ariaLabel: string;
  /** Plot height in px. Default: 192. */
  readonly height?: number;
  readonly testId?: string;
};

/** Stacked bars per bucket: positive values rise from the zero line, negative ones hang below. */
export function SignedBarChart({
  buckets,
  series,
  xAxis,
  yAxis,
  colors,
  formatValue = String,
  ariaLabel,
  height = DEFAULT_HEIGHT,
  testId,
}: SignedBarChartProps): ReactNode {
  const valueOf = (bucket: SignedBarBucket, key: string): number => bucket.values[key] ?? 0;
  const sums = buckets.map((bucket) => ({
    positive: series.reduce((sum, line) => sum + Math.max(0, valueOf(bucket, line.key)), 0),
    negative: series.reduce((sum, line) => sum + Math.min(0, valueOf(bucket, line.key)), 0),
  }));
  const yTicks = niceTicks(
    Math.min(0, ...sums.map((sum) => sum.negative)),
    Math.max(0, ...sums.map((sum) => sum.positive)),
    yAxis.ticks,
  );
  const yExtent = extentOfTicks(yTicks);
  const yOf = (y: number): number => (1 - share(yExtent, y)) * height;
  const formatY = formatterOf(yAxis);
  const slotWidth = VIEW_WIDTH / Math.max(1, buckets.length);
  const barWidth = slotWidth * 0.6;
  const labelEvery = Math.ceil(buckets.length / MAX_X_LABELS);

  return (
    <PlotFrame
      height={height}
      ariaLabel={ariaLabel}
      testId={testId}
      yLabels={yTicks.map((tick) => ({
        label: formatY(tick),
        position: 1 - share(yExtent, tick),
      }))}
      xLabels={buckets.flatMap((bucket, index) =>
        index % labelEvery === 0
          ? [{ label: xAxis.format(bucket.x), position: (index + 0.5) / buckets.length }]
          : [],
      )}
      footer={
        <ChartLegend
          formatValue={formatValue}
          items={series.map((line, index) => ({
            key: line.key,
            label: line.label,
            color: chartColor(line.key, index, undefined, colors),
          }))}
        />
      }
    >
      {buckets.map((bucket, bucketIndex) => {
        const left = bucketIndex * slotWidth + (slotWidth - barWidth) / 2;
        let positiveTop = 0;
        let negativeBottom = 0;
        return (
          <g key={bucket.x}>
            {series.map((line, index) => {
              const value = valueOf(bucket, line.key);
              if (value === 0) return null;
              const from = value > 0 ? positiveTop : negativeBottom;
              const to = from + value;
              if (value > 0) positiveTop = to;
              else negativeBottom = to;
              return (
                <rect
                  key={line.key}
                  data-testid={`signed-bar-${line.key}`}
                  data-sign={value > 0 ? "positive" : "negative"}
                  x={left}
                  width={barWidth}
                  y={Math.min(yOf(from), yOf(to))}
                  height={Math.abs(yOf(from) - yOf(to))}
                  fill={chartColor(line.key, index, undefined, colors)}
                >
                  <title>{`${line.label}: ${formatValue(value)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      <line
        data-testid="signed-bar-zero-line"
        x1={0}
        x2={VIEW_WIDTH}
        y1={yOf(0)}
        y2={yOf(0)}
        stroke="var(--color-muted-foreground)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </PlotFrame>
  );
}

export type HistogramBin = {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly count: number;
};

export type HistogramChartProps = {
  readonly bins: readonly HistogramBin[];
  readonly xAxis: NumericAxis;
  readonly yAxis: NumericAxis;
  /** Vertical dashed lines, e.g. a breakeven value. */
  readonly referenceLines?: readonly { readonly value: number; readonly label?: string }[];
  readonly color?: string;
  readonly ariaLabel: string;
  /** Plot height in px. Default: 192. */
  readonly height?: number;
  readonly testId?: string;
};

/** Bars over numeric bins: each bar spans its start..end on the x axis. */
export function HistogramChart({
  bins,
  xAxis,
  yAxis,
  referenceLines = [],
  color = chartToneColor("active"),
  ariaLabel,
  height = DEFAULT_HEIGHT,
  testId,
}: HistogramChartProps): ReactNode {
  const xBounds = rangeOf(bins.flatMap((bin) => [bin.start, bin.end]));
  const xTicks = niceTicks(xBounds.min, xBounds.max, xAxis.ticks).filter(
    (tick) => tick >= xBounds.min && tick <= xBounds.max,
  );
  const yTicks = niceTicks(0, Math.max(0, ...bins.map((bin) => bin.count)), yAxis.ticks);
  const yExtent = extentOfTicks(yTicks);
  const xOf = (x: number): number => share(xBounds, x) * VIEW_WIDTH;
  const yOf = (y: number): number => (1 - share(yExtent, y)) * height;
  const formatX = formatterOf(xAxis);
  const formatY = formatterOf(yAxis);
  const drawableReferences = referenceLines.filter(
    (line) => line.value >= xBounds.min && line.value <= xBounds.max,
  );

  return (
    <PlotFrame
      height={height}
      ariaLabel={ariaLabel}
      testId={testId}
      yLabels={yTicks.map((tick) => ({
        label: formatY(tick),
        position: 1 - share(yExtent, tick),
      }))}
      xLabels={xTicks.map((tick) => ({ label: formatX(tick), position: share(xBounds, tick) }))}
      overlay={drawableReferences.map((line) =>
        line.label === undefined ? null : (
          <ReferenceLabel
            key={line.value}
            label={line.label}
            className="top-0"
            style={{ left: `${share(xBounds, line.value) * 100}%` }}
          />
        ),
      )}
    >
      {bins.map((bin) => (
        <rect
          key={bin.id}
          data-testid="histogram-bin"
          data-bin-id={bin.id}
          x={xOf(bin.start)}
          width={Math.max(0, xOf(bin.end) - xOf(bin.start))}
          y={yOf(bin.count)}
          height={Math.max(0, yOf(0) - yOf(bin.count))}
          fill={color}
          stroke="var(--color-background)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        >
          <title>{String(bin.count)}</title>
        </rect>
      ))}
      {drawableReferences.map((line) => (
        <line
          key={line.value}
          data-testid="histogram-reference-line"
          x1={xOf(line.value)}
          x2={xOf(line.value)}
          y1={0}
          y2={height}
          stroke="var(--color-muted-foreground)"
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </PlotFrame>
  );
}
