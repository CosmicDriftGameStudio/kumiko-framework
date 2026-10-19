import type { ReactNode } from "react";

export type FeedRow = {
  readonly id: string;
  readonly primary: string;
  readonly trailing?: string;
};

/** Nicht-tabellarische Kurzliste (z.B. "nächste Termine") — Primary-Text +
 *  optionaler rechtsbündiger Trailing-Wert pro Zeile. */
export function FeedList({
  rows,
  emptyContent,
  testId,
}: {
  readonly rows: readonly FeedRow[];
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  if (rows.length === 0) {
    return <div data-testid={testId}>{emptyContent}</div>;
  }
  return (
    <ul data-testid={testId} className="flex max-h-64 flex-col overflow-y-auto pr-1 text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
          <span>{row.primary}</span>
          {row.trailing !== undefined && (
            <span className="tabular-nums text-muted-foreground">{row.trailing}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
