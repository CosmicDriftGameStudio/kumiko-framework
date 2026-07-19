import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Fortschrittsbalken, `value` 0..1 (wird geclampt). */
export function ProgressBar({
  value,
  className,
  testId,
}: {
  readonly value: number;
  readonly className?: string;
  readonly testId?: string;
}): ReactNode {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div
      data-testid={testId}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
