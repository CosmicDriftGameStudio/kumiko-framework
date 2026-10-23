import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { type ChartMarker, percent } from "./chart-data.ts";

// A 16px pin on a ~230px-wide plot (390px viewport) collides when markers sit
// within ~7% of each other, so close pins are staggered into extra rows.
const MARKER_PIN_MIN_GAP_FRACTION = 0.07;
const MARKER_PIN_MAX_ROWS = 3;
const MARKER_PIN_ROW_HEIGHT_PX = 18;

export function assignPinRows(fractions: readonly number[]): readonly number[] {
  const lastFractionPerRow: number[] = [];
  return fractions.map((fraction) => {
    let row = lastFractionPerRow.findIndex(
      (last) => fraction - last >= MARKER_PIN_MIN_GAP_FRACTION,
    );
    if (row === -1) {
      row =
        lastFractionPerRow.length < MARKER_PIN_MAX_ROWS
          ? lastFractionPerRow.length
          : MARKER_PIN_MAX_ROWS - 1;
    }
    lastFractionPerRow[row] = fraction;
    return row;
  });
}

export type KeyedMarker = ChartMarker & { readonly key: string };

// Two markers may share atMs and label, so the occurrence count keeps React keys unique.
export function sortMarkers(markers: readonly ChartMarker[]): readonly KeyedMarker[] {
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

export function MarkerPins({
  markers,
  windowStartMs,
  windowEndMs,
  numbered = true,
  formatMarkerTime,
  className,
}: {
  readonly className?: string;
  readonly markers: readonly ChartMarker[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  /** false: plain colored dots whose tooltip carries label and time. */
  readonly numbered?: boolean;
  readonly formatMarkerTime?: (atMs: number) => string;
}): ReactNode {
  const span = Math.max(1, windowEndMs - windowStartMs);
  const sorted = sortMarkers(markers);
  const fractions = sorted.map((marker) =>
    Math.max(0, Math.min(1, (marker.atMs - windowStartMs) / span)),
  );
  const rows = assignPinRows(fractions);
  const rowCount = Math.max(1, ...rows.map((row) => row + 1));
  return (
    <div
      aria-hidden="true"
      className={cn("relative mt-1", className)}
      style={{ height: rowCount * MARKER_PIN_ROW_HEIGHT_PX }}
    >
      {sorted.map((marker, i) => (
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
            numbered ? "size-4" : "size-2",
            marker.color === undefined && "bg-foreground",
          )}
          style={{
            left: percent(fractions[i] ?? 0),
            top: (rows[i] ?? 0) * MARKER_PIN_ROW_HEIGHT_PX + (numbered ? 0 : 4),
            ...(marker.color !== undefined && { backgroundColor: marker.color }),
          }}
        >
          {numbered ? i + 1 : null}
        </span>
      ))}
    </div>
  );
}

export function markerLegendItems(
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

export function MarkerLegend({
  markers,
  formatMarkerTime,
  className,
}: {
  readonly className?: string;
  readonly markers: readonly ChartMarker[];
  readonly formatMarkerTime?: (atMs: number) => string;
}): ReactNode {
  return (
    <ol className={cn("flex flex-col gap-1 text-xs text-muted-foreground", className)}>
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
