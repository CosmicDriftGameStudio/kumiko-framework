import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Read-only Schlüssel-Wert-Liste für Detail-Masken (Label links gedimmt,
 *  Wert rechts). Wert ist ReactNode → Badges/Chips möglich. `emphasize` hebt
 *  eine Zeile hervor (z.B. das Endergebnis in einem Rechner). */
export function DetailList({
  rows,
  testId,
}: {
  readonly rows: readonly {
    /** Optional stable key -- falls back to the label when omitted (fine as
     *  long as labels are unique; set id when they can repeat). */
    readonly id?: string;
    readonly label: string;
    readonly value: ReactNode;
    readonly emphasize?: boolean;
  }[];
  readonly testId?: string;
}): ReactNode {
  return (
    <dl data-testid={testId} className="flex flex-col divide-y">
      {rows.map((row) => (
        <div
          key={row.id ?? row.label}
          className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4"
        >
          <dt
            className={cn(
              "text-sm text-muted-foreground",
              row.emphasize === true && "font-semibold text-foreground",
            )}
          >
            {row.label}
          </dt>
          <dd className={cn("text-sm font-medium", row.emphasize === true && "font-semibold")}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
