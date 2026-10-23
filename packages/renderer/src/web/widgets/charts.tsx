import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn.ts";
import {
  NARROW_VIEWPORT_BREAKPOINT_PX,
  useIsViewportBelow,
} from "../primitives/use-narrow-viewport.ts";
import {
  bucketTimes,
  type ChartMarker,
  type ChartSeries,
  type ColorMap,
  chartColor,
  clampDotY,
  percent,
  SINGLE_POINT_RADIUS,
  seriesTotal,
  type TimeseriesPoint,
  type ToneMap,
  valueAt,
} from "./chart-data.ts";
import { MarkerLegend, MarkerPins } from "./chart-markers.tsx";
import { ChartLegend, evenYTickValues, YTicks } from "./chart-parts.tsx";
import { STATUS_TONE_TEXT, type StatusTone } from "./status-badge.tsx";

// Inline SVG charts without a chart dependency. Colors come exclusively from the
// --color-status-* / --color-foreground theme tokens; axis labels are supplied
// translated by the caller, so the widget makes no locale assumptions.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const TONE_VAR: Record<StatusTone, string> = {
  ok: "var(--color-status-ok)",
  warn: "var(--color-status-warn)",
  bad: "var(--color-status-bad)",
  critical: "var(--color-status-critical)",
  muted: "var(--color-muted-foreground)",
};

export type StatusBarEntry = {
  /** Stable key (z.B. ISO-Datum). */
  readonly key: string;
  /** Bar height from 0 to 1 (e.g. operational=1, degraded=0.75, outage=0.25). */
  readonly level: number;
  readonly tone: StatusTone;
  /** Tooltip text (<title>), supplied translated by the caller. */
  readonly label?: string;
};

/** Status bar strip (e.g. 90-day uptime): variable-height bars with
 *  gradient fade + tick line on top; the last entry gets a "now"
 *  accent stripe. `dense` swaps this for a flat-fill, fixed-size
 *  variant sized to fit a table cell instead of stretching to `w-full`. */
export function StatusBarChart({
  entries,
  ariaLabel,
  startLabel,
  endLabel,
  highlightLast = true,
  dense = false,
  testId,
}: {
  readonly entries: readonly StatusBarEntry[];
  readonly ariaLabel: string;
  /** Left and right axis labels below the chart, supplied translated. */
  readonly startLabel?: string;
  readonly endLabel?: string;
  readonly highlightLast?: boolean;
  /** Compact variant for table cells: fixed intrinsic size (no `w-full` stretch), flat fills instead of gradients, no tick marks. */
  readonly dense?: boolean;
  readonly testId?: string;
}): ReactNode {
  const gradPrefix = useId();
  if (entries.length === 0) return <div className={dense ? "h-3" : "h-9"} aria-hidden />;

  const chartHeight = dense ? 12 : 36;
  const tickHeight = dense ? 0 : 1;
  const barWidth = dense ? 3 : 1;
  const barGap = 1;
  const lastIdx = entries.length - 1;
  const totalWidth = entries.length * (barWidth + barGap);

  return (
    <div data-testid={testId}>
      <svg
        viewBox={`0 0 ${totalWidth} ${chartHeight}`}
        preserveAspectRatio={dense ? undefined : "none"}
        width={dense ? totalWidth : undefined}
        height={dense ? chartHeight : undefined}
        className={dense ? "block" : "block h-9 w-full"}
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        {entries.map((entry, idx) => {
          const x = idx * (barWidth + barGap);
          const level = Math.max(0, Math.min(1, entry.level));
          // Dense has no tick rect, so level 0 would otherwise render nothing and lose its tooltip.
          const barHeight = Math.max((chartHeight - tickHeight) * level, dense ? 1 : 0);
          const barY = chartHeight - barHeight;
          const isLast = highlightLast && idx === lastIdx;
          const color = TONE_VAR[entry.tone];
          const gradId = `${gradPrefix}-${idx}`;
          return (
            <g key={entry.key}>
              {!dense && (
                <defs>
                  <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={isLast ? 0.85 : 0.5} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
              )}
              {isLast && (
                <rect
                  x={x - barGap / 2}
                  y={0}
                  width={barWidth + barGap}
                  height={chartHeight}
                  fill="var(--color-foreground)"
                  fillOpacity={0.06}
                />
              )}
              <rect
                x={x}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill={dense ? color : `url(#${gradId})`}
                fillOpacity={dense ? (isLast ? 1 : 0.75) : undefined}
              >
                {entry.label !== undefined && <title>{entry.label}</title>}
              </rect>
              {!dense && (
                <rect
                  x={x}
                  y={barY - tickHeight}
                  width={barWidth}
                  height={tickHeight}
                  fill="var(--color-foreground)"
                  fillOpacity={isLast ? 1.0 : 0.7}
                />
              )}
            </g>
          );
        })}
      </svg>
      {(startLabel !== undefined || endLabel !== undefined) && (
        <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
}

/** Quadratic midpoint technique: smooths the zigzag line without overshoot
 *  (~5 lines instead of a Catmull-Rom/Bezier fit). */
export function smoothPath(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): string {
  const first = pts[0];
  if (!first) return "";
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    if (!cur || !next) break;
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    d += ` Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  if (!last) return d;
  return `${d} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

export type TimeseriesYAxis = {
  /** Number of gridlines including the zero baseline (min 2). Tick values are
   *  rounded to 1/2/5 x 10^n steps and the y-scale reaches the top tick. */
  readonly ticks: number;
  /** Label text per tick value (unit, locale). Default: the plain number. */
  readonly format?: (value: number) => string;
  /** Ready-to-display unit (e.g. "ms"), shown once above the tick labels so
   *  `format` can stay unit-free. */
  readonly unit?: string;
};

/** Pixel height, or one height per viewport class. `narrowBelowPx` defaults
 *  to the shared narrow-viewport breakpoint (768). */
export type TimeseriesHeight =
  | number
  | { readonly narrow: number; readonly wide: number; readonly narrowBelowPx?: number };

export type TimeseriesXAxis = {
  /** Number of evenly spaced time labels (min 2). */
  readonly ticks: number;
  readonly format: (atMs: number) => string;
};

const DEFAULT_TIMESERIES_HEIGHT_CLASS = "h-16";
const MIN_AXIS_TICKS = 2;
const MAX_AXIS_TICKS = 20;

function clampTickCount(requested: number): number {
  return Math.min(
    MAX_AXIS_TICKS,
    Math.max(MIN_AXIS_TICKS, Math.floor(requested) || MIN_AXIS_TICKS),
  );
}

function evenlySpaced(count: number): readonly number[] {
  const n = clampTickCount(count);
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

function yTickPosition(index: number, count: number): string {
  if (index === 0) return "-translate-y-full";
  if (index === count - 1) return "";
  return "-translate-y-1/2";
}

export type TimeseriesReferenceLine = {
  /** Same unit as the point values (e.g. a p95 or SLO threshold in ms). */
  readonly value: number;
  /** Translated by the caller. */
  readonly label: string;
  readonly tone?: StatusTone;
};

/** Time-series line chart (smoothed line with area fill). The x-axis uses
 *  TIME within windowStartMs..windowEndMs rather than the index, so 5-minute
 *  data in a 30-day window correctly appears as a narrow strip on the right. */
export function TimeseriesChart({
  points,
  windowStartMs,
  windowEndMs,
  tone = "ok",
  ariaLabel,
  axisLabels,
  xAxis,
  yAxis,
  height,
  markers,
  formatMarkerTime,
  referenceLines,
  emptyContent,
  testId,
}: {
  readonly points: readonly TimeseriesPoint[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly tone?: StatusTone;
  readonly ariaLabel: string;
  /** Axis row below the chart, formatted and translated by the caller. */
  readonly axisLabels?: { readonly start: string; readonly mid?: string; readonly end: string };
  /** Date axis with n evenly spaced labels; replaces `axisLabels` when set. */
  readonly xAxis?: TimeseriesXAxis;
  /** Gridlines plus value labels in a left gutter. */
  readonly yAxis?: TimeseriesYAxis;
  /** Chart height in px. Default: 64 (`h-16`). */
  readonly height?: TimeseriesHeight;
  /** Numbered pins on the x-axis plus a numbered list below the chart. */
  readonly markers?: readonly ChartMarker[];
  readonly formatMarkerTime?: (atMs: number) => string;
  /** Dashed horizontal threshold lines (e.g. p95); they extend the y-scale
   *  when above the data maximum. Non-finite and negative values are dropped. */
  readonly referenceLines?: readonly TimeseriesReferenceLine[];
  /** Rendered instead of the chart when there is no value; a single value
   *  is drawn as a point. */
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const gradientId = useId();
  const descId = useId();
  const chartWidth = 300;
  const chartHeight = 64;
  const isNarrow = useIsViewportBelow(
    typeof height === "object"
      ? (height.narrowBelowPx ?? NARROW_VIEWPORT_BREAKPOINT_PX)
      : NARROW_VIEWPORT_BREAKPOINT_PX,
  );
  const heightPx = typeof height === "object" ? (isNarrow ? height.narrow : height.wide) : height;
  const heightClass = heightPx === undefined ? DEFAULT_TIMESERIES_HEIGHT_CLASS : undefined;
  const heightStyle = heightPx === undefined ? undefined : { height: heightPx };

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-[13px] text-muted-foreground",
          heightClass,
        )}
        style={heightStyle}
      >
        {emptyContent}
      </div>
    );
  }

  const drawableLines = (referenceLines ?? []).filter(
    (line) => Number.isFinite(line.value) && line.value >= 0,
  );
  const singleValue = values.length === 1 ? values[0] : undefined;
  // A lone value at the top edge would sit on the clip boundary; doubling the
  // scale centres it.
  const dataMax = Math.max(
    ...values.map((value) => (singleValue === undefined ? value : value * 2)),
    ...drawableLines.map((line) => line.value),
    1,
  );
  const yTicks = yAxis === undefined ? [] : niceYTicks(dataMax, yAxis.ticks);
  const maxValue = yTicks.length > 0 ? (yTicks[yTicks.length - 1] ?? dataMax) : dataMax;
  const yOf = (value: number) => chartHeight - (value / maxValue) * chartHeight;
  const span = Math.max(1, windowEndMs - windowStartMs);
  const xOf = (atMs: number) =>
    Math.max(0, Math.min(1, (atMs - windowStartMs) / span)) * chartWidth;
  const chartPoints = points.map((p) => ({
    x: xOf(p.atMs),
    y: p.value === null ? chartHeight : yOf(p.value),
  }));
  const linePath = smoothPath(chartPoints);
  const firstPoint = chartPoints[0];
  const lastPoint = chartPoints[chartPoints.length - 1];
  const areaPath =
    firstPoint && lastPoint
      ? `${linePath} L ${lastPoint.x.toFixed(1)} ${chartHeight} L ${firstPoint.x.toFixed(1)} ${chartHeight} Z`
      : "";
  const color = TONE_VAR[tone];
  const hasReferenceLines = drawableLines.length > 0;

  const svg = (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      preserveAspectRatio="none"
      className={cn("block w-full", heightClass)}
      style={heightStyle}
      role="img"
      aria-label={ariaLabel}
      aria-describedby={hasReferenceLines ? descId : undefined}
    >
      <title>{ariaLabel}</title>
      {hasReferenceLines && <desc id={descId}>{drawableLines.map((l) => l.label).join(", ")}</desc>}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {yTicks.map((tick) => (
        <line
          key={`grid-${tick}`}
          data-grid-line=""
          x1={0}
          x2={chartWidth}
          y1={yOf(tick)}
          y2={yOf(tick)}
          stroke="var(--color-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {singleValue === undefined ? (
        <>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : (
        <circle
          data-testid="timeseries-single-point"
          cx={chartWidth / 2}
          cy={clampDotY(yOf(singleValue), chartHeight)}
          r={SINGLE_POINT_RADIUS}
          fill={color}
        />
      )}
      {drawableLines.map((line) => (
        <line
          key={`${line.value}:${line.label}`}
          data-reference-line=""
          x1={0}
          x2={chartWidth}
          y1={yOf(line.value)}
          y2={yOf(line.value)}
          stroke={TONE_VAR[line.tone ?? "muted"]}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );

  const plot = (
    <>
      {hasReferenceLines ? (
        <div className="relative">
          {svg}
          {drawableLines.map((line) => (
            <span
              key={`${line.value}:${line.label}`}
              aria-hidden="true"
              className={cn(
                "absolute right-0 rounded bg-background/80 px-1 text-[11px]",
                // A line near the top would push its label above the chart box.
                yOf(line.value) >= chartHeight / 4 && "-translate-y-full",
                STATUS_TONE_TEXT[line.tone ?? "muted"],
              )}
              style={{ top: `${(yOf(line.value) / chartHeight) * 100}%` }}
            >
              {line.label}
            </span>
          ))}
        </div>
      ) : (
        svg
      )}
      {xAxis !== undefined ? (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          {evenlySpaced(xAxis.ticks).map((fraction) => (
            <span key={fraction} data-x-label="">
              {xAxis.format(windowStartMs + fraction * (windowEndMs - windowStartMs))}
            </span>
          ))}
        </div>
      ) : (
        axisLabels !== undefined && (
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{axisLabels.start}</span>
            {axisLabels.mid !== undefined && <span>{axisLabels.mid}</span>}
            <span>{axisLabels.end}</span>
          </div>
        )
      )}
    </>
  );

  return (
    <div data-testid={testId} className={STATUS_TONE_TEXT[tone]}>
      {yAxis === undefined ? (
        plot
      ) : (
        <div className={cn("flex gap-1.5", yAxis.unit !== undefined && "pt-4")}>
          <div
            aria-hidden="true"
            className={cn(
              "relative w-12 shrink-0 text-right text-[11px] text-muted-foreground",
              heightClass,
            )}
            style={heightStyle}
          >
            {yAxis.unit !== undefined && (
              <span
                data-testid={testId === undefined ? undefined : `${testId}-y-unit`}
                data-y-unit=""
                className="absolute right-0 bottom-full mb-1 whitespace-nowrap leading-none"
              >
                {yAxis.unit}
              </span>
            )}
            {yTicks.map((tick, index) => (
              <span
                key={tick}
                data-y-label=""
                className={cn(
                  "absolute right-0 whitespace-nowrap leading-none",
                  yTickPosition(index, yTicks.length),
                )}
                style={{ top: `${(yOf(tick) / chartHeight) * 100}%` }}
              >
                {(yAxis.format ?? String)(tick)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">{plot}</div>
        </div>
      )}
      {markers !== undefined && markers.length > 0 && (
        <div className="text-foreground">
          <MarkerPins markers={markers} windowStartMs={windowStartMs} windowEndMs={windowEndMs} />
          <div className="mt-2">
            <MarkerLegend markers={markers} formatMarkerTime={formatMarkerTime} />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Dashboard charts: stacked bars/areas, segment bars, markers ---

export type SegmentBarRow = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly segments: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: number;
  }[];
};

function niceCeil(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function niceYTicks(max: number, tickCount: number): readonly number[] {
  const count = clampTickCount(tickCount);
  const step = niceCeil(max / (count - 1));
  // toPrecision strips float noise such as 3 * 0.2 = 0.6000000000000001 from labels and keys.
  return Array.from({ length: count }, (_, i) => Number((i * step).toPrecision(12)));
}

const BAR_LABEL_TARGET = 8;

/** Vertically stacked bars per bucket (x axis = bucket, not time).
 *  The last bucket carries `todayLabel` when it contains `windowEndMs` and
 *  has day granularity. */
export function StackedBarChart({
  series,
  windowEndMs,
  tones,
  colors,
  ariaLabel,
  todayLabel,
  formatBucketLabel,
  formatValue = String,
  formatAxisValue = formatValue,
  emptyContent,
  testId,
}: {
  readonly series: readonly ChartSeries[];
  readonly windowEndMs: number;
  readonly tones?: ToneMap;
  readonly colors?: ColorMap;
  readonly ariaLabel: string;
  readonly todayLabel: string;
  readonly formatBucketLabel: (atMs: number) => string;
  readonly formatValue?: (value: number) => string;
  /** y-axis tick labels only; defaults to `formatValue`. */
  readonly formatAxisValue?: (value: number) => string;
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const times = bucketTimes(series);
  if (times.length === 0) return <div data-testid={testId}>{emptyContent}</div>;

  const totals = times.map((atMs) => series.reduce((sum, s) => sum + valueAt(s, atMs), 0));
  const max = niceCeil(Math.max(...totals));
  const lastIdx = times.length - 1;
  const lastAtMs = times[lastIdx] ?? 0;
  const prevAtMs = times[lastIdx - 1];
  const stepMs = prevAtMs !== undefined ? lastAtMs - prevAtMs : DAY_MS;
  const lastIsToday = stepMs >= DAY_MS - HOUR_MS && windowEndMs - lastAtMs <= stepMs;
  const labelEvery = Math.max(1, Math.ceil(times.length / BAR_LABEL_TARGET));

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <YTicks
          values={evenYTickValues(max)}
          formatValue={formatAxisValue}
          className="h-40 pb-5 pt-0"
        />
        <div
          role="img"
          aria-label={ariaLabel}
          className="flex h-40 grow gap-1 border-b border-border-row"
        >
          {times.map((atMs, i) => {
            const label = i === lastIdx && lastIsToday ? todayLabel : formatBucketLabel(atMs);
            return (
              <div
                key={atMs}
                title={`${label}: ${formatValue(totals[i] ?? 0)}`}
                className="flex min-w-0 flex-1 flex-col"
              >
                <div className="relative flex-1">
                  <div
                    className="absolute inset-x-0 bottom-0 flex flex-col-reverse gap-px"
                    style={{ height: percent((totals[i] ?? 0) / max) }}
                  >
                    {series.map((s, si) => {
                      const value = valueAt(s, atMs);
                      if (value <= 0) return null;
                      return (
                        <div
                          key={s.key}
                          data-testid={`chart-bar-segment-${s.key}`}
                          style={{
                            height: percent(value / (totals[i] ?? 1)),
                            backgroundColor: chartColor(s.key, si, tones, colors),
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="h-5 pt-1 text-center text-[11px] leading-4 whitespace-nowrap text-muted-foreground">
                  {(lastIdx - i) % labelEvery === 0 ? label : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ChartLegend
        formatValue={formatValue}
        items={series.map((s, i) => ({
          key: s.key,
          label: s.label,
          color: chartColor(s.key, i, tones, colors),
          total: seriesTotal(s),
        }))}
      />
    </div>
  );
}

/** One horizontally stacked bar per row; bar length is relative to the
 *  largest row so rows stay comparable. */
export function SegmentBarChart({
  rows,
  tones,
  colors,
  ariaLabel,
  formatValue = String,
  testId,
}: {
  readonly rows: readonly SegmentBarRow[];
  readonly tones?: ToneMap;
  readonly colors?: ColorMap;
  readonly ariaLabel: string;
  readonly formatValue?: (value: number) => string;
  readonly testId?: string;
}): ReactNode {
  const rowTotal = (row: SegmentBarRow): number =>
    row.segments.length > 0 ? row.segments.reduce((sum, s) => sum + s.value, 0) : row.value;
  const maxTotal = Math.max(1, ...rows.map(rowTotal));

  const segmentTotals = new Map<string, { label: string; total: number }>();
  for (const row of rows) {
    for (const seg of row.segments) {
      const known = segmentTotals.get(seg.key);
      segmentTotals.set(seg.key, {
        label: known?.label ?? seg.label,
        total: (known?.total ?? 0) + seg.value,
      });
    }
  }
  const legendKeys = [...segmentTotals.keys()];

  return (
    <div data-testid={testId} role="img" aria-label={ariaLabel} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.key} data-testid={`chart-row-${row.key}`} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{row.label}</span>
              <span className="tabular-nums text-muted-foreground">{formatValue(row.value)}</span>
            </div>
            <div className="flex h-2 gap-px overflow-hidden rounded-full bg-muted">
              {row.segments.map((seg) => (
                <div
                  key={seg.key}
                  title={`${seg.label}: ${formatValue(seg.value)}`}
                  className="h-full"
                  style={{
                    width: percent(seg.value / maxTotal),
                    backgroundColor: chartColor(
                      seg.key,
                      legendKeys.indexOf(seg.key),
                      tones,
                      colors,
                    ),
                  }}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <ChartLegend
        formatValue={formatValue}
        items={legendKeys.map((key, i) => ({
          key,
          label: segmentTotals.get(key)?.label ?? key,
          color: chartColor(key, i, tones, colors),
          total: segmentTotals.get(key)?.total ?? 0,
        }))}
      />
    </div>
  );
}

export type {
  ChartLine,
  ChartMarker,
  ChartSeries,
  ChartTone,
  TimeseriesPoint,
} from "./chart-data.ts";
export { chartToneColor } from "./chart-data.ts";
export { assignPinRows } from "./chart-markers.tsx";
export { StackedAreaChart } from "./stacked-area-chart.tsx";
