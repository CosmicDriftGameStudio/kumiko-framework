import {
  type ChartLine,
  type ChartMarker,
  type ChartSeries,
  type ColorMap,
  chartColor,
  clampDotY,
  type ToneMap,
  valueAt,
} from "./chart-data.ts";
import { type KeyedMarker, sortMarkers } from "./chart-markers.tsx";
import { evenYTickValues } from "./chart-parts.tsx";

export const STACKED_AREA_PLOT_HEIGHT_CLASS = "h-56 @2xl:h-64";

export const PLOT_WIDTH = 300;
export const PLOT_HEIGHT = 120;

// Container-query density tiers for the x axis: label budget per tier.
export const AXIS_TIERS = [
  { maxLabels: 4, visibilityClass: "@xl:hidden" },
  { maxLabels: 7, visibilityClass: "hidden @xl:block @4xl:hidden" },
  { maxLabels: 12, visibilityClass: "hidden @4xl:block" },
] as const;

const FINE_NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

// Finer than niceCeil so a 1.1 M peak tops out at 1.2 M instead of 2 M.
function fineNiceCeil(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = FINE_NICE_STEPS.find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
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

export function bucketTotals(
  times: readonly number[],
  series: readonly ChartSeries[],
): readonly number[] {
  return times.map((atMs) => series.reduce((sum, s) => sum + valueAt(s, atMs), 0));
}

type Colors = { readonly tones: ToneMap | undefined; readonly colors: ColorMap | undefined };

export type StackedBand = {
  readonly key: string;
  readonly color: string;
  readonly edge: string;
  readonly d: string;
  readonly dot: number | undefined;
};

function buildBands(input: {
  readonly times: readonly number[];
  readonly series: readonly ChartSeries[];
  readonly yOf: (value: number) => number;
  readonly fractionOf: (atMs: number) => number;
  readonly palette: Colors;
}): readonly StackedBand[] {
  const { times, series, yOf, fractionOf, palette } = input;
  const isSingleBucket = times.length === 1;
  const lower = times.map(() => 0);
  return series.map((s, si) => {
    const upper = times.map((atMs, ti) => (lower[ti] ?? 0) + valueAt(s, atMs));
    const top = times.map(
      (atMs, ti) =>
        `${(fractionOf(atMs) * PLOT_WIDTH).toFixed(1)} ${yOf(upper[ti] ?? 0).toFixed(1)}`,
    );
    const bottom = times
      .map(
        (atMs, ti) =>
          `${(fractionOf(atMs) * PLOT_WIDTH).toFixed(1)} ${yOf(lower[ti] ?? 0).toFixed(1)}`,
      )
      .reverse();
    const bucketTop = upper[0] ?? 0;
    const bucketHeight = bucketTop - (lower[0] ?? 0);
    for (let ti = 0; ti < times.length; ti++) lower[ti] = upper[ti] ?? 0;
    return {
      key: s.key,
      color: chartColor(s.key, si, palette.tones, palette.colors),
      edge: `M ${top.join(" L ")}`,
      d: `M ${top.join(" L ")} L ${bottom.join(" L ")} Z`,
      dot: isSingleBucket && bucketHeight > 0 ? clampDotY(yOf(bucketTop), PLOT_HEIGHT) : undefined,
    };
  });
}

export type StackedLinePath = {
  readonly key: string;
  readonly label: string;
  readonly dashed: boolean;
  readonly color: string;
  readonly d: string;
};

export function buildStackedAreaGeometry(input: {
  readonly times: readonly number[];
  readonly totals: readonly number[];
  readonly series: readonly ChartSeries[];
  readonly lines: readonly ChartLine[];
  readonly markers: readonly ChartMarker[] | undefined;
  readonly fractionOf: (atMs: number) => number;
  readonly palette: Colors;
}) {
  const { times, totals, series, lines, markers, fractionOf, palette } = input;
  const lineValues = lines.flatMap((line) =>
    line.points.flatMap((p) => (p.value === null ? [] : [p.value])),
  );
  // Doubling keeps a lone bucket away from the top edge of the y-scale.
  const max = fineNiceCeil(Math.max(...totals, ...lineValues) * (times.length === 1 ? 2 : 1));
  const yOf = (value: number): number => PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;
  const lineColorOffset = series.length;
  const linePaths: readonly StackedLinePath[] = lines.map((line, li) => ({
    key: line.key,
    label: line.label,
    dashed: line.dashed === true,
    color: chartColor(line.key, lineColorOffset + li, palette.tones, palette.colors),
    d: linePathSegments(line, (atMs) => fractionOf(atMs) * PLOT_WIDTH, yOf),
  }));
  return {
    yTickValues: evenYTickValues(max),
    yOf,
    bands: buildBands({ times, series, yOf, fractionOf, palette }),
    linePaths,
    coloredMarkers: sortMarkers(markers ?? []).filter(
      (marker): marker is KeyedMarker & { readonly color: string } => marker.color !== undefined,
    ),
  };
}

export type StackedAreaGeometry = ReturnType<typeof buildStackedAreaGeometry>;
