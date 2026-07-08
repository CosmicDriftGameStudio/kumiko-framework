import type { ReactNode } from "react";

/** Read-only Schlüssel-Wert-Liste für Detail-Masken (Label links gedimmt,
 *  Wert rechts). Wert ist ReactNode → Badges/Chips möglich. */
export function DetailList({
  rows,
  testId,
}: {
  readonly rows: readonly { readonly label: string; readonly value: ReactNode }[];
  readonly testId?: string;
}): ReactNode {
  return (
    <dl data-testid={testId} className="flex flex-col divide-y">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="text-sm font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
