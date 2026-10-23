import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";
import { percent } from "./chart-data.ts";
import {
  type ChartWindow,
  nearestIndex,
  snapBrushWindow,
  snapMovedBrushWindow,
} from "./chart-window.ts";

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

export function StackedAreaBrush({
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
      onChange(snapMovedBrushWindow(times, drag.originStartMs, drag.originEndMs, shift));
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
    "absolute top-0 z-10 h-full w-6 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
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
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 rounded-sm bg-foreground/60"
      />
    </div>
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
