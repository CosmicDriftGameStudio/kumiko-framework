export type TimeseriesPoint = {
  readonly atMs: number;
  /** null = outage/no value → falls to the baseline for a visible drop. */
  readonly value: number | null;
};

export const SINGLE_POINT_RADIUS = 3;

export function clampDotY(y: number, height: number): number {
  return Math.max(SINGLE_POINT_RADIUS, Math.min(height - SINGLE_POINT_RADIUS, y));
}

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

export type ToneMap = Readonly<Record<string, ChartTone>>;
/** Key -> raw CSS color; wins over the tone map. */
export type ColorMap = Readonly<Record<string, string>>;

export function chartColor(
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

export function bucketTimes(series: readonly ChartSeries[]): readonly number[] {
  const times = new Set<number>();
  for (const s of series) for (const p of s.points) times.add(p.atMs);
  return [...times].sort((a, b) => a - b);
}

export function valueAt(series: ChartSeries, atMs: number): number {
  return series.points.find((p) => p.atMs === atMs)?.value ?? 0;
}

export function seriesTotal(series: ChartSeries): number {
  return series.points.reduce((sum, p) => sum + (p.value ?? 0), 0);
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}
