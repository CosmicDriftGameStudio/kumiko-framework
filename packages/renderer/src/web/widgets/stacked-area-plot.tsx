import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { type ChartMarker, percent } from "./chart-data.ts";
import { MarkerPins } from "./chart-markers.tsx";
import { AXIS_TIERS } from "./stacked-area-geometry.ts";
import type { StackedAreaModel } from "./stacked-area-model.ts";
import { renderPlotSvg } from "./stacked-area-svg.tsx";
import { renderTooltipOverlay } from "./stacked-area-tooltip.tsx";

const MARKER_LABEL_FLIP_FRACTION = 0.97;

function bucketLabelTransform(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? "-translate-x-full" : "-translate-x-1/2";
}

type MarkerLabelGroup = {
  readonly atMs: number;
  readonly text: string;
  readonly color: string;
};

// Markers sharing a timestamp become one label ("A, B") in the first one's color.
function groupMarkerLabels(markers: readonly ChartMarker[]): readonly MarkerLabelGroup[] {
  const groups = new Map<number, ChartMarker[]>();
  for (const marker of [...markers].sort((a, b) => a.atMs - b.atMs)) {
    groups.set(marker.atMs, [...(groups.get(marker.atMs) ?? []), marker]);
  }
  return [...groups.entries()].map(([atMs, members]) => ({
    atMs,
    text: members.map((m) => m.label).join(", "),
    color: members[0]?.color ?? "var(--color-foreground)",
  }));
}

function renderTodayLabel(m: StackedAreaModel, todayFraction: number): ReactNode {
  return (
    <span
      data-testid="chart-today-label"
      className="absolute -top-4 -translate-x-1/2 text-[11px] text-foreground"
      style={{ left: percent(todayFraction) }}
    >
      {m.props.todayLabel}
    </span>
  );
}

function renderScrollableAxis(m: StackedAreaModel): ReactNode {
  const { times, fractionOf, formatBucket } = m.win;
  return (
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
  );
}

function renderTickedAxis(m: StackedAreaModel): ReactNode {
  const { fractionOf, formatBucket, windowStartMs, windowEndMs, tierTicks } = m.win;
  return (
    <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
      <span className="absolute left-0 whitespace-nowrap">{formatBucket(windowStartMs)}</span>
      <span className="absolute right-0 whitespace-nowrap">{formatBucket(windowEndMs)}</span>
      {AXIS_TIERS.map((tier, tierIndex) => (
        <div key={tier.maxLabels} className={cn("absolute inset-0", tier.visibilityClass)}>
          {(tierTicks[tierIndex] ?? []).map((tickMs) => (
            <span
              key={tickMs}
              data-testid="chart-axis-tick"
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: percent(fractionOf(tickMs)) }}
            >
              {formatBucket(tickMs)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function renderMarkerLabels(m: StackedAreaModel): ReactNode {
  return groupMarkerLabels(m.win.markers ?? []).map((group) => {
    const fraction = m.win.fractionOf(group.atMs);
    const flipped = fraction > MARKER_LABEL_FLIP_FRACTION;
    return (
      <div
        key={group.atMs}
        className={cn(
          "pointer-events-none absolute top-0 hidden @2xl:block",
          flipped ? "-translate-x-full pr-1" : "pl-1",
        )}
        style={{ left: percent(fraction) }}
      >
        <span
          data-testid="chart-marker-label"
          className="block max-h-44 rotate-180 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-none [writing-mode:vertical-rl] @2xl:max-h-60"
          style={{ color: group.color }}
        >
          {group.text}
        </span>
      </div>
    );
  });
}

function renderMarkerPins(m: StackedAreaModel, markers: readonly ChartMarker[]): ReactNode {
  const { markerLegend, markerLabels } = m.props;
  return (
    <MarkerPins
      markers={markers}
      windowStartMs={m.win.windowStartMs}
      windowEndMs={m.win.windowEndMs}
      numbered={markerLegend === "list" || markerLabels}
      formatMarkerTime={m.win.formatMarkerTimeInWindow}
      {...(markerLabels && { className: "@2xl:hidden" })}
    />
  );
}

export function renderStackedAreaPlot(m: StackedAreaModel): ReactNode {
  const { todayFraction, markers } = m.win;
  return (
    <>
      {todayFraction !== undefined && renderTodayLabel(m, todayFraction)}
      {renderPlotSvg(m)}
      {m.props.scrollable ? renderScrollableAxis(m) : renderTickedAxis(m)}
      {renderTooltipOverlay(m)}
      {m.props.markerLabels && renderMarkerLabels(m)}
      {markers !== undefined && markers.length > 0 && renderMarkerPins(m, markers)}
    </>
  );
}
