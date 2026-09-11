import type { MetricProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Borderless cell in the metrics-band Grid — `first:border-l-0` drops the
// divider on the first cell purely from DOM position, so the tiles read as
// one row of vertical dividers instead of individual cards (fw record-
// screen-type polish). Typo matches StatCard's label/value rhythm.
export function DefaultMetric({ label, value, testId, onPress }: MetricProps): ReactNode {
  const cellClassName = "border-l first:border-l-0 px-4 py-3";
  const content = (
    <>
      <div
        className="text-xs text-muted-foreground"
        data-testid={testId !== undefined ? `${testId}-label` : undefined}
      >
        {label}
      </div>
      <div
        className="mt-0.5 text-xl font-semibold tabular-nums text-foreground"
        data-testid={testId !== undefined ? `${testId}-value` : undefined}
      >
        {value}
      </div>
    </>
  );
  if (onPress !== undefined) {
    return (
      <button
        type="button"
        data-testid={testId}
        className={cn(cellClassName, "w-full text-left hover:bg-muted/50")}
        onClick={onPress}
      >
        {content}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={cellClassName}>
      {content}
    </div>
  );
}
