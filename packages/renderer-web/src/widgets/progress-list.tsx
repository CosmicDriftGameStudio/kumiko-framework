import type { ReactNode } from "react";
import { ProgressBar } from "./progress-bar";

export type ProgressListRow = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly fraction: number;
};

/** Liste aus Label/Wert-Kopfzeile + Fortschrittsbalken pro Eintrag (z.B.
 *  Tilgungsfortschritt pro Kredit). */
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
            <span className="tabular-nums text-muted-foreground">{row.value}</span>
          </div>
          <ProgressBar value={row.fraction} />
        </li>
      ))}
    </ul>
  );
}
