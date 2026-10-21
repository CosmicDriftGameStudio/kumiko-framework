import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { ProgressBar } from "./progress-bar.tsx";

export type ProgressListRow = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** null renders no bar (nothing to measure against, e.g. an unlimited cap). */
  readonly fraction: number | null;
  /** danger colors bar and value. */
  readonly tone?: "default" | "danger";
  /** Small line under the bar, e.g. "42 % repaid". */
  readonly sub?: string;
};

/** Label/value header and progress bar for each entry (for example, loan repayment progress). */
export function ProgressList({
  rows,
  emptyContent,
  testId,
}: {
  readonly rows: readonly ProgressListRow[];
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  if (rows.length === 0) {
    return <div data-testid={testId}>{emptyContent}</div>;
  }
  return (
    <ul data-testid={testId} className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{row.label}</span>
            <span
              className={cn(
                "tabular-nums",
                row.tone === "danger" ? "text-status-critical" : "text-muted-foreground",
              )}
            >
              {row.value}
            </span>
          </div>
          {row.fraction !== null && <ProgressBar value={row.fraction} tone={row.tone} />}
          {row.sub !== undefined && <div className="text-xs text-muted-foreground">{row.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
