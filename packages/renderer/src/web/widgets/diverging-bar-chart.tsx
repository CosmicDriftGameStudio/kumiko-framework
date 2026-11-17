import type { ReactNode } from "react";
import { type ChartTone, chartToneColor } from "./chart-data.ts";

export type DivergingBarRow = {
  readonly key: string;
  /** Translated by the caller. */
  readonly label: string;
  readonly value: number;
};

export type DivergingBarChartProps = {
  readonly rows: readonly DivergingBarRow[];
  readonly formatValue?: (value: number) => string;
  /** Default: "positive". */
  readonly positiveTone?: ChartTone;
  /** Default: "negative". */
  readonly negativeTone?: ChartTone;
  readonly ariaLabel: string;
  readonly testId?: string;
};

/** Signed horizontal bars around a centre line, largest absolute value first (tornado chart). */
export function DivergingBarChart({
  rows,
  formatValue = String,
  positiveTone = "positive",
  negativeTone = "negative",
  ariaLabel,
  testId,
}: DivergingBarChartProps): ReactNode {
  const sorted = [...rows].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const maxAbs = Math.max(0, ...sorted.map((row) => Math.abs(row.value)));
  return (
    <div role="img" aria-label={ariaLabel} data-testid={testId} className="flex flex-col gap-1.5">
      {sorted.map((row) => {
        const negative = row.value < 0;
        const halfWidth = maxAbs === 0 ? 0 : (Math.abs(row.value) / maxAbs) * 50;
        return (
          <div
            key={row.key}
            data-testid="diverging-bar-row"
            data-key={row.key}
            data-sign={negative ? "negative" : "positive"}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2 text-xs"
          >
            <span className="truncate text-muted-foreground">{row.label}</span>
            <div className="relative h-4">
              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <span
                className="absolute inset-y-0.5 rounded-sm"
                style={{
                  width: `${halfWidth}%`,
                  backgroundColor: chartToneColor(negative ? negativeTone : positiveTone),
                  ...(negative ? { right: "50%" } : { left: "50%" }),
                }}
              />
            </div>
            <span className="tabular-nums text-foreground">{formatValue(row.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
