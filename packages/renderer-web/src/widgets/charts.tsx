import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn.js";
import {
  type ChartWindow,
  initialWindowSelection,
  nearestIndex,
  pointsWithin,
  resolveStackedAreaWindow,
  type StackedAreaDateFormat,
  type StackedAreaInitialWindow,
  type StackedAreaRanges,
  type StackedAreaWindowSelection,
  snapBrushWindow,
  stackedAreaDateFormatFor,
} from "./chart-window.js";
import { ModeSwitch } from "./mode-switch.js";
import { STATUS_TONE_TEXT, type StatusTone } from "./status-badge.js";

// Inline-SVG-Charts — kein Chart-Dep. Farben ausschließlich über die
// --color-status-* / --color-foreground Theme-Tokens; Achsen-Labels
// kommen translated vom Caller (keine Locale-Annahmen im Widget).

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
  /** Balkenhöhe 0..1 (z.B. operational=1, degraded=0.75, outage=0.25). */
  readonly level: number;
  readonly tone: StatusTone;
  /** Tooltip-Text (<title>) — translated vom Caller. */
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
  /** Achsen-Beschriftung links/rechts unter dem Chart — translated. */
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

const SINGLE_POINT_RADIUS = 3;

function clampDotY(y: number, height: number): number {
  return Math.max(SINGLE_POINT_RADIUS, Math.min(height - SINGLE_POINT_RADIUS, y));
}

/** Quadratic-durch-Mittelpunkte-Trick: glättet die Zick-Zack-Linie ohne
 *  Overshoot (~5 Zeilen statt Catmull-Rom/Bezier-Fit). */
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

export type TimeseriesPoint = {
  readonly atMs: number;
  /** null = Ausfall/kein Wert → fällt auf die Grundlinie (sichtbarer Einbruch). */
  readonly value: number | null;
};

export type TimeseriesYAxis = {
  /** Number of gridlines including the zero baseline (min 2). Tick values are
   *  rounded to 1/2/5 x 10^n steps and the y-scale reaches the top tick. */
  readonly ticks: number;
  /** Label text per tick value (unit, locale). Default: the plain number. */
  readonly format?: (value: number) => string;
};

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

/** Zeitreihen-Linien-Chart (geglättete Linie + Flächen-Verlauf). x-Achse =
 *  ZEIT im Fenster windowStartMs..windowEndMs, nicht Index — 5 Min Daten in
 *  einem 30-Tage-Fenster ergeben ehrlich einen schmalen Streifen rechts. */
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
  /** Achsen-Zeile unter dem Chart (translated/formatiert vom Caller). */
  readonly axisLabels?: { readonly start: string; readonly mid?: string; readonly end: string };
  /** Date axis with n evenly spaced labels; replaces `axisLabels` when set. */
  readonly xAxis?: TimeseriesXAxis;
  /** Gridlines plus value labels in a left gutter. */
  readonly yAxis?: TimeseriesYAxis;
  /** Chart height in px. Default: 64 (`h-16`). */
  readonly height?: number;
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
  const heightClass = height === undefined ? DEFAULT_TIMESERIES_HEIGHT_CLASS : undefined;
  const heightStyle = height === undefined ? undefined : { height };

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
        <div className="flex gap-1.5">
          <div
            aria-hidden="true"
            className={cn(
              "relative w-12 shrink-0 text-right text-[11px] text-muted-foreground",
              heightClass,
            )}
            style={heightStyle}
          >
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

export type ChartTone = "positive" | "negative" | "active" | "neutral";

const CHART_TONE_VAR: Record<ChartTone, string> = {
  positive: "var(--color-status-ok)",
  negative: "var(--color-status-bad)",
  active: "var(--color-status-active)",
  neutral: "var(--color-status-neutral)",
};

export function chartToneColor(tone: ChartTone): string {
  return CHART_TONE_VAR[tone];
}

const CHART_FALLBACK_TONES: readonly ChartTone[] = ["active", "positive", "negative", "neutral"];

export type ChartSeries = {
  readonly key: string;
  /** Translated by the caller. */
  readonly label: string;
  readonly points: readonly TimeseriesPoint[];
};

export type ChartMarker = {
  readonly atMs: number;
  readonly label: string;
  /** Colors the pin and, on StackedAreaChart, draws a dashed guide line in the plot. */
  readonly color?: string;
  /** Translated by the caller. Groups markers into one legend entry when `markerLegend` is "legend". */
  readonly legendLabel?: string;
};

/** Unstacked line drawn over a StackedAreaChart on the same y scale. */
export type ChartLine = ChartSeries & { readonly dashed?: boolean };

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

type ToneMap = Readonly<Record<string, ChartTone>>;
/** Key -> raw CSS color; wins over the tone map. */
type ColorMap = Readonly<Record<string, string>>;

function chartColor(
  key: string,
  index: number,
  tones: ToneMap | undefined,
  colors?: ColorMap,
): string {
  const color = colors?.[key];
  if (color !== undefined) return color;
  const tone =
    tones?.[key] ?? CHART_FALLBACK_TONES[index % CHART_FALLBACK_TONES.length] ?? "active";
  return CHART_TONE_VAR[tone];
}

const Y_TICK_COUNT = 3;

function niceCeil(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

const FINE_NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

// Finer than niceCeil so a 1.1 M peak tops out at 1.2 M instead of 2 M.
function fineNiceCeil(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = FINE_NICE_STEPS.find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

function niceYTicks(max: number, tickCount: number): readonly number[] {
  const count = clampTickCount(tickCount);
  const step = niceCeil(max / (count - 1));
  return Array.from({ length: count }, (_, i) => i * step);
}

function bucketTimes(series: readonly ChartSeries[]): readonly number[] {
  const times = new Set<number>();
  for (const s of series) for (const p of s.points) times.add(p.atMs);
  return [...times].sort((a, b) => a - b);
}

function valueAt(series: ChartSeries, atMs: number): number {
  return series.points.find((p) => p.atMs === atMs)?.value ?? 0;
}

function linePathSegments(
  line: ChartSeries,
  xOf: (atMs: number) => number,
  yOf: (value: number) => number,
): string {
  const commands: string[] = [];
  let penDown = false;
  for (const point of [...line.points].sort((a, b) => a.atMs - b.atMs)) {
    if (point.value === null) {
      penDown = false;
      continue;
    }
    commands.push(
      `${penDown ? "L" : "M"} ${xOf(point.atMs).toFixed(1)} ${yOf(point.value).toFixed(1)}`,
    );
    penDown = true;
  }
  return commands.join(" ");
}

function seriesTotal(series: ChartSeries): number {
  return series.points.reduce((sum, p) => sum + (p.value ?? 0), 0);
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

function ChartLegend({
  items,
  formatValue,
}: {
  readonly items: readonly {
    readonly key: string;
    readonly label: string;
    readonly color: string;
    /** Omitted: no sum next to the label. */
    readonly total?: number;
    readonly swatch?: "area" | "line" | "dashed-line";
  }[];
  readonly formatValue: (value: number) => string;
}): ReactNode {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li
          key={item.key}
          data-testid={`chart-legend-${item.key}`}
          className="flex items-center gap-1.5"
        >
          {item.swatch === undefined || item.swatch === "area" ? (
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="w-3 border-t-2"
              style={{
                borderColor: item.color,
                borderTopStyle: item.swatch === "dashed-line" ? "dashed" : "solid",
              }}
            />
          )}
          <span>{item.label}</span>
          {item.total !== undefined && (
            <span className="tabular-nums text-foreground">{formatValue(item.total)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function YTicks({
  max,
  formatValue,
  className,
}: {
  readonly max: number;
  readonly formatValue: (value: number) => string;
  readonly className?: string;
}): ReactNode {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-col-reverse justify-between text-right text-[11px] tabular-nums text-muted-foreground",
        className,
      )}
    >
      {Array.from({ length: Y_TICK_COUNT }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: statische Tick-Liste
        <span key={i}>{formatValue((max / (Y_TICK_COUNT - 1)) * i)}</span>
      ))}
    </div>
  );
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
        <YTicks max={max} formatValue={formatValue} className="h-40 pb-5 pt-0" />
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

type KeyedMarker = ChartMarker & { readonly key: string };

// Two markers may share atMs and label, so the occurrence count keeps React keys unique.
function sortMarkers(markers: readonly ChartMarker[]): readonly KeyedMarker[] {
  const seen = new Map<string, number>();
  return [...markers]
    .sort((a, b) => a.atMs - b.atMs)
    .map((marker) => {
      const base = `${marker.atMs}-${marker.label}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return { ...marker, key: `${base}-${occurrence}` };
    });
}

function MarkerPins({
  markers,
  windowStartMs,
  windowEndMs,
  numbered = true,
  formatMarkerTime,
}: {
  readonly markers: readonly ChartMarker[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  /** false: plain colored dots whose tooltip carries label and time. */
  readonly numbered?: boolean;
  readonly formatMarkerTime?: (atMs: number) => string;
}): ReactNode {
  const span = Math.max(1, windowEndMs - windowStartMs);
  return (
    <div aria-hidden="true" className="relative mt-1 h-5">
      {sortMarkers(markers).map((marker, i) => (
        <span
          key={marker.key}
          data-testid="chart-marker-pin"
          title={
            numbered
              ? undefined
              : formatMarkerTime === undefined
                ? marker.label
                : `${marker.label} · ${formatMarkerTime(marker.atMs)}`
          }
          className={cn(
            "absolute flex -translate-x-1/2 items-center justify-center rounded-full text-[10px] font-medium text-background",
            numbered ? "size-4" : "top-1 size-2",
            marker.color === undefined && "bg-foreground",
          )}
          style={{
            left: percent(Math.max(0, Math.min(1, (marker.atMs - windowStartMs) / span))),
            ...(marker.color !== undefined && { backgroundColor: marker.color }),
          }}
        >
          {numbered ? i + 1 : null}
        </span>
      ))}
    </div>
  );
}

function markerLegendItems(
  markers: readonly ChartMarker[],
): readonly { readonly key: string; readonly label: string; readonly color: string }[] {
  const items = new Map<string, { key: string; label: string; color: string }>();
  for (const marker of markers) {
    const label = marker.legendLabel ?? marker.label;
    const color = marker.color ?? "var(--color-foreground)";
    const key = `marker-${label}-${color}`;
    if (!items.has(key)) items.set(key, { key, label, color });
  }
  return [...items.values()];
}

function MarkerLegend({
  markers,
  formatMarkerTime,
}: {
  readonly markers: readonly ChartMarker[];
  readonly formatMarkerTime?: (atMs: number) => string;
}): ReactNode {
  return (
    <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
      {sortMarkers(markers).map((marker, i) => (
        <li key={marker.key} data-testid="chart-marker-item" className="flex gap-2">
          <span
            className="w-4 shrink-0 text-center tabular-nums text-foreground"
            style={marker.color !== undefined ? { color: marker.color } : undefined}
          >
            {i + 1}
          </span>
          <span>{marker.label}</span>
          {formatMarkerTime !== undefined && (
            <span className="ml-auto tabular-nums">{formatMarkerTime(marker.atMs)}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

const SCROLLABLE_BUCKET_WIDTH_PX = 48;

function bucketLabelTransform(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? "-translate-x-full" : "-translate-x-1/2";
}

const DEFAULT_BRUSH_LABELS = { start: "Window start", end: "Window end" } as const;
const BRUSH_OVERVIEW_WIDTH = 100;
const BRUSH_OVERVIEW_HEIGHT = 24;

type BrushHandle = "start" | "end";
type BrushDragMode = BrushHandle | "move";
type BrushDrag = {
  readonly mode: BrushDragMode;
  readonly originX: number;
  readonly originStartMs: number;
  readonly originEndMs: number;
};

function brushKeyTarget(key: string, index: number, min: number, max: number): number | undefined {
  if (key === "ArrowLeft") return index - 1;
  if (key === "ArrowRight") return index + 1;
  if (key === "Home") return min;
  return key === "End" ? max : undefined;
}

function StackedAreaBrush({
  times,
  totals,
  window,
  labels,
  onChange,
  testId,
}: {
  readonly times: readonly number[];
  readonly totals: readonly number[];
  readonly window: ChartWindow;
  readonly labels: { readonly start: string; readonly end: string };
  readonly onChange: (window: ChartWindow) => void;
  readonly testId: string;
}): ReactNode {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<BrushDrag | null>(null);
  const firstMs = times[0] ?? 0;
  const lastMs = times[times.length - 1] ?? 1;
  const span = Math.max(1, lastMs - firstMs);
  const fractionOf = (atMs: number): number => Math.max(0, Math.min(1, (atMs - firstMs) / span));
  const startIndex = nearestIndex(times, window.startMs);
  const endIndex = nearestIndex(times, window.endMs);
  const lastIndex = times.length - 1;
  const max = Math.max(...totals, 1);
  const overviewPoints = times.map(
    (atMs, i) =>
      `${(fractionOf(atMs) * BRUSH_OVERVIEW_WIDTH).toFixed(1)} ${(
        BRUSH_OVERVIEW_HEIGHT - ((totals[i] ?? 0) / max) * BRUSH_OVERVIEW_HEIGHT
      ).toFixed(1)}`,
  );
  const overviewPath = `M 0 ${BRUSH_OVERVIEW_HEIGHT} L ${overviewPoints.join(" L ")} L ${BRUSH_OVERVIEW_WIDTH} ${BRUSH_OVERVIEW_HEIGHT} Z`;

  const commit = (startMs: number, endMs: number, anchor: BrushHandle): void =>
    onChange(snapBrushWindow(times, startMs, endMs, anchor));

  const beginDrag =
    (mode: BrushDragMode) =>
    (e: PointerEvent<HTMLElement>): void => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        originX: e.clientX,
        originStartMs: window.startMs,
        originEndMs: window.endMs,
      };
    };
  const moveDrag = (e: PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    const trackWidth = trackRef.current?.getBoundingClientRect().width ?? 0;
    if (drag === null || trackWidth <= 0) return;
    const deltaMs = ((e.clientX - drag.originX) / trackWidth) * span;
    if (drag.mode === "move") {
      const shift = Math.max(
        firstMs - drag.originStartMs,
        Math.min(lastMs - drag.originEndMs, deltaMs),
      );
      commit(drag.originStartMs + shift, drag.originEndMs + shift, "start");
    } else if (drag.mode === "start") {
      commit(drag.originStartMs + deltaMs, drag.originEndMs, "start");
    } else {
      commit(drag.originStartMs, drag.originEndMs + deltaMs, "end");
    }
  };
  const endDrag = (): void => {
    dragRef.current = null;
  };
  const dragHandlers = (mode: BrushDragMode) => ({
    onPointerDown: beginDrag(mode),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  const handleKeyDown =
    (handle: BrushHandle) =>
    (e: KeyboardEvent<HTMLElement>): void => {
      const isStart = handle === "start";
      const index = isStart ? startIndex : endIndex;
      const min = isStart ? 0 : startIndex + 1;
      const maxIndex = isStart ? endIndex - 1 : lastIndex;
      const target = brushKeyTarget(e.key, index, min, maxIndex);
      if (target === undefined) return;
      e.preventDefault();
      const next = Math.max(min, Math.min(maxIndex, target));
      if (next === index) return;
      const nextStart = times[isStart ? next : startIndex];
      const nextEnd = times[isStart ? endIndex : next];
      if (nextStart !== undefined && nextEnd !== undefined) {
        onChange({ startMs: nextStart, endMs: nextEnd });
      }
    };

  const startFraction = fractionOf(window.startMs);
  const endFraction = fractionOf(window.endMs);
  const handleClass =
    "absolute top-0 z-10 h-full w-2 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm bg-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const renderHandle = (handle: BrushHandle): ReactNode => (
    <div
      data-testid={`${testId}-${handle}`}
      role="slider"
      tabIndex={0}
      aria-label={labels[handle]}
      aria-valuemin={handle === "start" ? 0 : startIndex + 1}
      aria-valuemax={handle === "start" ? endIndex - 1 : lastIndex}
      aria-valuenow={handle === "start" ? startIndex : endIndex}
      className={handleClass}
      style={{ left: percent(handle === "start" ? startFraction : endFraction) }}
      onKeyDown={handleKeyDown(handle)}
      {...dragHandlers(handle)}
    />
  );

  return (
    <div
      ref={trackRef}
      data-testid={testId}
      className="relative h-8 w-full select-none rounded-sm border border-border"
    >
      <svg
        viewBox={`0 0 ${BRUSH_OVERVIEW_WIDTH} ${BRUSH_OVERVIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        role="presentation"
      >
        <path d={overviewPath} fill="var(--color-muted-foreground)" fillOpacity={0.25} />
      </svg>
      <div
        data-testid={`${testId}-window`}
        className="absolute top-0 h-full cursor-grab touch-none border-x border-primary bg-primary/10"
        style={{
          left: percent(startFraction),
          width: percent(Math.max(0, endFraction - startFraction)),
        }}
        {...dragHandlers("move")}
      />
      {renderHandle("start")}
      {renderHandle("end")}
    </div>
  );
}

/** Stacked bands over time. Right of `todayMs` is the forecast: lighter
 *  fill plus a vertical "today" line. */
export function StackedAreaChart({
  series: allSeries,
  windowStartMs: fullWindowStartMs,
  windowEndMs: fullWindowEndMs,
  todayMs,
  tones,
  colors,
  markers: allMarkers,
  lines: allLines = [],
  ranges,
  initialWindow,
  brush = false,
  windowSelection,
  onWindowSelectionChange,
  brushLabels = DEFAULT_BRUSH_LABELS,
  ariaLabel,
  todayLabel,
  formatBucketLabel,
  formatValue = String,
  formatMarkerTime,
  dateFormat,
  markerLegend = "list",
  scrollable = false,
  showLegendTotals = true,
  emptyContent,
  testId,
}: {
  readonly series: readonly ChartSeries[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly todayMs?: number;
  readonly tones?: ToneMap;
  readonly colors?: ColorMap;
  readonly markers?: readonly ChartMarker[];
  /** Drawn over the bands, not stacked. A `null` value breaks the line. */
  readonly lines?: readonly ChartLine[];
  /** Range presets anchored at today; uncontrolled, the widget renders the switch itself. */
  readonly ranges?: StackedAreaRanges;
  /** Uncontrolled start window; "from-today" ignores the default range and starts at today. */
  readonly initialWindow?: StackedAreaInitialWindow;
  /** Scrubber under the plot to drag the visible window; starts at today without `ranges`. */
  readonly brush?: boolean;
  readonly windowSelection?: StackedAreaWindowSelection;
  /** Makes the window controlled: no own range switch, `windowSelection` is the only source. */
  readonly onWindowSelectionChange?: (selection: StackedAreaWindowSelection) => void;
  /** aria-labels of the two brush handles. */
  readonly brushLabels?: { readonly start: string; readonly end: string };
  readonly ariaLabel: string;
  readonly todayLabel: string;
  readonly formatBucketLabel: (atMs: number, format: StackedAreaDateFormat) => string;
  readonly formatValue?: (value: number) => string;
  readonly formatMarkerTime?: (atMs: number, format: StackedAreaDateFormat) => string;
  /** Overrides the automatic format (month and year once the visible window spans 18 months). */
  readonly dateFormat?: StackedAreaDateFormat;
  /** "legend": unnumbered pins with tooltip, one dashed legend entry per marker label and color. */
  readonly markerLegend?: "list" | "legend";
  /** Fixed width per bucket; the plot scrolls horizontally, y ticks stay put. */
  readonly scrollable?: boolean;
  readonly showLegendTotals?: boolean;
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const clipId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [internalSelection, setInternalSelection] = useState(
    initialWindowSelection(ranges, initialWindow),
  );
  const isControlled = onWindowSelectionChange !== undefined;
  const selection = isControlled ? windowSelection : internalSelection;
  const changeSelection = (next: StackedAreaWindowSelection): void => {
    if (isControlled) onWindowSelectionChange(next);
    else setInternalSelection(next);
  };
  const allTimes = bucketTimes([...allSeries, ...allLines]);
  const isWindowing = ranges !== undefined || brush || selection !== undefined;
  const fullWindow: ChartWindow = { startMs: fullWindowStartMs, endMs: fullWindowEndMs };
  const visibleWindow = isWindowing
    ? resolveStackedAreaWindow({
        selection,
        ranges,
        brush,
        todayMs,
        bucketTimes: allTimes,
        fullWindow,
      })
    : fullWindow;
  const windowStartMs = visibleWindow.startMs;
  const windowEndMs = visibleWindow.endMs;
  const effectiveDateFormat = dateFormat ?? stackedAreaDateFormatFor(visibleWindow);
  const formatBucket = (atMs: number): string => formatBucketLabel(atMs, effectiveDateFormat);
  const formatMarkerTimeInWindow =
    formatMarkerTime === undefined
      ? undefined
      : (atMs: number): string => formatMarkerTime(atMs, effectiveDateFormat);
  const isNarrowed = windowStartMs !== fullWindowStartMs || windowEndMs !== fullWindowEndMs;
  const series = isNarrowed
    ? allSeries.map((s) => ({ ...s, points: pointsWithin(s.points, visibleWindow) }))
    : allSeries;
  const lines = isNarrowed
    ? allLines.map((line) => ({ ...line, points: pointsWithin(line.points, visibleWindow) }))
    : allLines;
  const markers =
    isNarrowed && allMarkers !== undefined ? pointsWithin(allMarkers, visibleWindow) : allMarkers;
  const times = bucketTimes([...series, ...lines]);
  const bucketCount = times.length;
  const span = Math.max(1, windowEndMs - windowStartMs);
  const fractionOf = (atMs: number): number =>
    Math.max(0, Math.min(1, (atMs - windowStartMs) / span));
  const todayFraction = todayMs !== undefined ? fractionOf(todayMs) : undefined;

  useEffect(() => {
    const el = scrollRef.current;
    if (!scrollable || el === null || bucketCount === 0) return;
    el.scrollLeft =
      todayFraction === undefined
        ? el.scrollWidth
        : Math.max(0, todayFraction * el.scrollWidth - el.clientWidth / 2);
  }, [scrollable, todayFraction, bucketCount]);

  if (times.length === 0) return <div data-testid={testId}>{emptyContent}</div>;

  const width = 300;
  const height = 120;
  const totals = times.map((atMs) => series.reduce((sum, s) => sum + valueAt(s, atMs), 0));
  const lineValues = lines.flatMap((line) =>
    line.points.flatMap((p) => (p.value === null ? [] : [p.value])),
  );
  const isSingleBucket = times.length === 1;
  // Doubling keeps a lone bucket away from the top edge of the y-scale.
  const max = fineNiceCeil(Math.max(...totals, ...lineValues) * (isSingleBucket ? 2 : 1));
  const yOf = (value: number): number => height - (value / max) * height;

  const lower = times.map(() => 0);
  const bands = series.map((s, si) => {
    const upper = times.map((atMs, ti) => (lower[ti] ?? 0) + valueAt(s, atMs));
    const top = times.map(
      (atMs, ti) => `${(fractionOf(atMs) * width).toFixed(1)} ${yOf(upper[ti] ?? 0).toFixed(1)}`,
    );
    const bottom = times
      .map(
        (atMs, ti) => `${(fractionOf(atMs) * width).toFixed(1)} ${yOf(lower[ti] ?? 0).toFixed(1)}`,
      )
      .reverse();
    const bucketTop = upper[0] ?? 0;
    const bucketHeight = bucketTop - (lower[0] ?? 0);
    for (let ti = 0; ti < times.length; ti++) lower[ti] = upper[ti] ?? 0;
    return {
      key: s.key,
      color: chartColor(s.key, si, tones, colors),
      d: `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`,
      dot: isSingleBucket && bucketHeight > 0 ? clampDotY(yOf(bucketTop), height) : undefined,
    };
  });

  const lineColorOffset = series.length;
  const linePaths = lines.map((line, li) => ({
    key: line.key,
    label: line.label,
    dashed: line.dashed === true,
    color: chartColor(line.key, lineColorOffset + li, tones, colors),
    d: linePathSegments(line, (atMs) => fractionOf(atMs) * width, yOf),
  }));
  const coloredMarkers = sortMarkers(markers ?? []).filter(
    (marker): marker is KeyedMarker & { readonly color: string } => marker.color !== undefined,
  );

  const todayX = (todayFraction ?? 1) * width;
  const renderBands = (fillOpacity: number): ReactNode =>
    bands.map((band) =>
      band.dot === undefined ? (
        <path key={band.key} d={band.d} fill={band.color} fillOpacity={fillOpacity} stroke="none" />
      ) : (
        <circle
          key={band.key}
          data-testid="stacked-area-single-point"
          cx={width / 2}
          cy={band.dot}
          r={SINGLE_POINT_RADIUS}
          fill={band.color}
          fillOpacity={fillOpacity}
        />
      ),
    );

  const plot = (
    <>
      {todayFraction !== undefined && (
        <span
          data-testid="chart-today-label"
          className="absolute -top-4 -translate-x-1/2 text-[11px] text-foreground"
          style={{ left: percent(todayFraction) }}
        >
          {todayLabel}
        </span>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-32 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <defs>
          <clipPath id={`${clipId}-past`}>
            <rect x={0} y={0} width={todayX} height={height} />
          </clipPath>
          <clipPath id={`${clipId}-future`}>
            <rect x={todayX} y={0} width={width - todayX} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId}-past)`}>{renderBands(0.85)}</g>
        {todayFraction !== undefined && (
          <g data-testid="chart-forecast-region" clipPath={`url(#${clipId}-future)`}>
            {renderBands(0.3)}
          </g>
        )}
        {coloredMarkers.map((marker) => {
          const x = fractionOf(marker.atMs) * width;
          return (
            <line
              key={marker.key}
              data-testid="chart-marker-guide"
              x1={x}
              x2={x}
              y1={0}
              y2={height}
              stroke={marker.color}
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {linePaths.map((line) => (
          <path
            key={line.key}
            data-testid={`chart-line-${line.key}`}
            d={line.d}
            fill="none"
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray={line.dashed ? "6 4" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {todayFraction !== undefined && (
          <line
            data-testid="chart-today-line"
            x1={todayX}
            x2={todayX}
            y1={0}
            y2={height}
            stroke="var(--color-foreground)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {scrollable ? (
        <div
          data-testid="chart-bucket-labels"
          className="relative mt-1 h-4 text-[11px] text-muted-foreground"
        >
          {times.map((atMs, i) => (
            <span
              key={atMs}
              className={cn("absolute whitespace-nowrap", bucketLabelTransform(i, times.length))}
              style={{ left: percent(fractionOf(atMs)) }}
            >
              {formatBucket(atMs)}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{formatBucket(windowStartMs)}</span>
          <span>{formatBucket(windowEndMs)}</span>
        </div>
      )}
      {markers !== undefined && markers.length > 0 && (
        <MarkerPins
          markers={markers}
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          numbered={markerLegend === "list"}
          formatMarkerTime={formatMarkerTimeInWindow}
        />
      )}
    </>
  );

  const ownRangeSwitch =
    !isControlled && ranges !== undefined ? (
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
    ) : undefined;
  const brushBar =
    brush && allTimes.length >= 2 ? (
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
    ) : undefined;

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      {ownRangeSwitch}
      <div className="flex gap-2">
        <YTicks
          max={max}
          formatValue={formatValue}
          className={cn("h-32 pb-0", scrollable && "mt-4")}
        />
        {scrollable ? (
          <div
            ref={scrollRef}
            data-testid="chart-scroll-container"
            className="grow overflow-x-auto pt-4"
          >
            <div
              data-testid="chart-scroll-content"
              className="relative"
              style={{
                minWidth: "100%",
                width: `${times.length * SCROLLABLE_BUCKET_WIDTH_PX}px`,
              }}
            >
              {plot}
            </div>
          </div>
        ) : (
          <div className="relative grow">{plot}</div>
        )}
      </div>
      {brushBar}
      <ChartLegend
        formatValue={formatValue}
        items={[
          ...series.map((s, i) => ({
            key: s.key,
            label: s.label,
            color: chartColor(s.key, i, tones, colors),
            ...(showLegendTotals && { total: seriesTotal(s) }),
          })),
          ...linePaths.map((line) => ({
            key: line.key,
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
        ]}
      />
      {markerLegend === "list" && markers !== undefined && markers.length > 0 && (
        <MarkerLegend markers={markers} formatMarkerTime={formatMarkerTimeInWindow} />
      )}
    </div>
  );
}
