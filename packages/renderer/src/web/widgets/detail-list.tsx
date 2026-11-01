import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/**
 * Read-only key-value list for detail views (dimmed label on the left, value on the right). The
 * value is a ReactNode, so badges and chips are supported. `emphasize` highlights a row, such as
 * the final result in a calculator. `valueWeight="normal"` drops the value emphasis;
 * `layout="sidebar"` keeps label (narrow column) and right-aligned value on one row, for narrow
 * side columns.
 */
export function DetailList({
  rows,
  testId,
  valueWeight = "medium",
  layout = "default",
}: {
  readonly valueWeight?: "medium" | "normal";
  readonly layout?: "default" | "sidebar";
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
    <dl data-testid={testId} className="@container flex flex-col divide-y">
      {rows.map((row) => (
        <div
          key={row.id ?? row.label}
          className={
            layout === "sidebar"
              ? "grid grid-cols-[minmax(0,96px)_1fr] gap-3 py-2.5"
              : "grid grid-cols-1 gap-0.5 py-2.5 @md:grid-cols-[200px_1fr] @md:gap-4"
          }
        >
          <dt
            className={cn(
              "text-sm text-muted-foreground",
              row.emphasize === true && "font-semibold text-foreground",
            )}
          >
            {row.label}
          </dt>
          <dd
            className={cn(
              "text-sm",
              valueWeight === "medium" && "font-medium",
              layout === "sidebar" && "text-right",
              row.emphasize === true && "font-semibold",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
