import type { ReactNode } from "react";
import type { ChartLine, ChartMarker, ChartSeries, ColorMap, ToneMap } from "./chart-data.ts";
import type {
  StackedAreaDateFormat,
  StackedAreaInitialWindow,
  StackedAreaRanges,
  StackedAreaWindowSelection,
} from "./chart-window.ts";

const DEFAULT_BRUSH_LABELS = { start: "Window start", end: "Window end" } as const;

export type StackedAreaChartProps = {
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
  /** y-axis tick labels only (legend and totals keep `formatValue`); defaults to `formatValue`. */
  readonly formatAxisValue?: (value: number) => string;
  readonly formatMarkerTime?: (atMs: number, format: StackedAreaDateFormat) => string;
  /** Overrides the automatic format (month and year once the visible window spans 18 months). */
  readonly dateFormat?: StackedAreaDateFormat;
  /** Zone the x-axis ticks align to; must match the zone `formatBucketLabel` formats in. Default UTC. */
  readonly timeZone?: string;
  /** "legend": unnumbered pins with tooltip, one dashed legend entry per marker label and color. */
  readonly markerLegend?: "list" | "legend";
  /** Writes each marker label vertically next to its guide line on wide containers; narrow ones keep the pins. */
  readonly markerLabels?: boolean;
  /** Fixed width per bucket; the plot scrolls horizontally, y ticks stay put. */
  readonly scrollable?: boolean;
  readonly showLegendTotals?: boolean;
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
};

/** formatAxisValue defaults to the resolved formatValue, so the destructuring order matters. */
export function resolveStackedAreaProps({
  lines = [],
  brush = false,
  brushLabels = DEFAULT_BRUSH_LABELS,
  formatValue = String,
  formatAxisValue = formatValue,
  markerLegend = "list",
  markerLabels = false,
  scrollable = false,
  showLegendTotals = true,
  ...rest
}: StackedAreaChartProps) {
  return {
    ...rest,
    lines,
    brush,
    brushLabels,
    formatValue,
    formatAxisValue,
    markerLegend,
    markerLabels,
    scrollable,
    showLegendTotals,
  };
}

export type ResolvedStackedAreaProps = ReturnType<typeof resolveStackedAreaProps>;
