import type { ReactNode } from "react";
import type { KeyValueListProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";

export function DefaultKeyValueList({ rows }: KeyValueListProps): ReactNode {
  return (
    // Capped width: on a wide banner the value would otherwise sit far away from its label.
    <dl className="flex w-full max-w-md flex-col">
      {rows.map((row) => (
        <div
          key={row.key}
          {...(row.emphasize === true && { "data-emphasize": "" })}
          className={cn(
            "flex items-baseline justify-between gap-4 py-1.5 text-sm",
            row.emphasize === true && "mt-1 border-t pt-2.5 font-semibold",
          )}
        >
          <dt className={cn(row.emphasize !== true && "text-muted-foreground")}>{row.label}</dt>
          <dd className="text-right tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
