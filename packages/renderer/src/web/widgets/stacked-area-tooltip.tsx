import type { PointerEvent, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { chartColor, percent, valueAt } from "./chart-data.ts";
import { bucketIndexAtFraction } from "./chart-window.ts";
import { STACKED_AREA_PLOT_HEIGHT_CLASS } from "./stacked-area-geometry.ts";
import type { StackedAreaModel } from "./stacked-area-model.ts";

const TOOLTIP_WIDTH_REM = 14;
const TOOLTIP_OFFSET_PX = 8;
// A swipe over the plot (scrolling the page or the chart) must not open the card.
const TOOLTIP_TAP_MAX_MOVEMENT_PX = 8;

type ChartTooltipRow = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly swatch: "area" | "line" | "dashed-line";
  readonly value: number;
};

function buildTooltipRows(m: StackedAreaModel, tooltipAtMs: number): readonly ChartTooltipRow[] {
  const { tones, colors } = m.props;
  const { series, lines } = m.win;
  const { linePaths } = m.geometry;
  return [
    ...series.map(
      (s, i): ChartTooltipRow => ({
        key: s.key,
        label: s.label,
        color: chartColor(s.key, i, tones, colors),
        swatch: "area",
        value: valueAt(s, tooltipAtMs),
      }),
    ),
    ...lines.flatMap((line, li): readonly ChartTooltipRow[] => {
      const value = line.points.find((p) => p.atMs === tooltipAtMs)?.value;
      return value === null || value === undefined
        ? []
        : [
            {
              key: line.key,
              label: line.label,
              color: linePaths[li]?.color ?? "var(--color-foreground)",
              swatch: line.dashed === true ? "dashed-line" : "line",
              value,
            },
          ];
    }),
  ];
}

function renderTooltipSwatch(row: ChartTooltipRow): ReactNode {
  if (row.swatch === "area") {
    return (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: row.color }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="w-3 shrink-0 border-t-2"
      style={{
        borderColor: row.color,
        borderTopStyle: row.swatch === "dashed-line" ? "dashed" : "solid",
      }}
    />
  );
}

function renderTooltipCard(m: StackedAreaModel, tooltipAtMs: number): ReactNode {
  const tooltipFraction = m.win.fractionOf(tooltipAtMs);
  const tooltipOnLeft = tooltipFraction > 0.5;
  const tooltipEdge = `${percent(tooltipFraction)} ${tooltipOnLeft ? "-" : "+"} ${TOOLTIP_OFFSET_PX}px`;
  const tooltipLeft = tooltipOnLeft
    ? `max(0px, calc(${tooltipEdge} - ${TOOLTIP_WIDTH_REM}rem))`
    : `max(0px, min(calc(${tooltipEdge}), calc(100% - ${TOOLTIP_WIDTH_REM}rem)))`;
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40"
        style={{ left: percent(tooltipFraction) }}
      />
      <div
        data-testid="chart-tooltip"
        data-side={tooltipOnLeft ? "left" : "right"}
        className="pointer-events-none absolute top-2 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-sm"
        style={{ left: tooltipLeft, width: `min(${TOOLTIP_WIDTH_REM}rem, 100%)` }}
      >
        <div className="mb-1 font-medium">{m.win.formatBucket(tooltipAtMs)}</div>
        {buildTooltipRows(m, tooltipAtMs).map((row) => (
          <div key={row.key} className="flex items-center gap-1.5">
            {renderTooltipSwatch(row)}
            <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
            <span className="ml-auto tabular-nums">{m.props.formatAxisValue(row.value)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function bucketAtMsUnderPointer(
  m: StackedAreaModel,
  event: PointerEvent<HTMLDivElement>,
): number | null {
  const { times, visibleWindow } = m.win;
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    times[
      bucketIndexAtFraction(
        times,
        visibleWindow,
        rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width,
      )
    ] ?? null
  );
}

export function renderTooltipOverlay(m: StackedAreaModel): ReactNode {
  const { tooltipAtMs, setSelectedTooltipAtMs, tooltipOverlayRef, touchStartRef } = m.tooltip;
  return (
    <div
      ref={tooltipOverlayRef}
      data-testid="chart-tooltip-overlay"
      className={cn("absolute inset-x-0 top-0", STACKED_AREA_PLOT_HEIGHT_CLASS)}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") setSelectedTooltipAtMs(bucketAtMsUnderPointer(m, event));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setSelectedTooltipAtMs(null);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        touchStartRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerCancel={() => {
        touchStartRef.current = null;
      }}
      onPointerUp={(event) => {
        const start = touchStartRef.current;
        touchStartRef.current = null;
        if (event.pointerType === "mouse" || start === null) return;
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (moved >= TOOLTIP_TAP_MAX_MOVEMENT_PX) return;
        const next = bucketAtMsUnderPointer(m, event);
        setSelectedTooltipAtMs((current) => (current === next ? null : next));
      }}
    >
      {tooltipAtMs !== undefined && renderTooltipCard(m, tooltipAtMs)}
    </div>
  );
}
