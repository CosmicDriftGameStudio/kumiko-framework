import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Progress bar, `value` 0..1 (clamped).
 *
 * The track lives in its own inner element so a parent that pads or
 * stretches its direct children (e.g. RenderEdit's wizard chrome) never
 * touches the track's own `h-2` — a caller's `className` reaches the
 * outer wrapper, not the height-bearing track.
 */
export function ProgressBar({
  value,
  className,
  testId,
}: {
  readonly value: number;
  readonly className?: string;
  readonly testId?: string;
}): ReactNode {
  // `value` is typically `done / total`; total:0 produces NaN, which would
  // otherwise leak into `width: "NaN%"` and an invalid aria-valuenow.
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div className={cn("w-full", className)}>
      <div
        data-testid={testId}
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
