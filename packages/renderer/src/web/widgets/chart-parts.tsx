import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export function ChartLegend({
  items,
  formatValue,
}: {
  readonly items: readonly {
    readonly key: string;
    /** Defaults to the key; set when the key is prefixed to avoid collisions. */
    readonly testIdKey?: string;
    readonly label: string;
    readonly color: string;
    /** Omitted: no sum next to the label. */
    readonly total?: number;
    readonly swatch?: "area" | "line" | "dashed-line";
  }[];
  readonly formatValue: (value: number) => string;
}): ReactNode {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li
          key={item.key}
          data-testid={`chart-legend-${item.testIdKey ?? item.key}`}
          className="flex items-center gap-1.5"
        >
          {item.swatch === undefined || item.swatch === "area" ? (
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="w-3 border-t-2"
              style={{
                borderColor: item.color,
                borderTopStyle: item.swatch === "dashed-line" ? "dashed" : "solid",
              }}
            />
          )}
          <span>{item.label}</span>
          {item.total !== undefined && (
            <span className="tabular-nums text-foreground">{formatValue(item.total)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

const Y_TICK_COUNT = 3;

export function evenYTickValues(max: number): readonly number[] {
  return Array.from({ length: Y_TICK_COUNT }, (_, i) => (max / (Y_TICK_COUNT - 1)) * i);
}

export function YTicks({
  values,
  formatValue,
  className,
}: {
  readonly values: readonly number[];
  readonly formatValue: (value: number) => string;
  readonly className?: string;
}): ReactNode {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex flex-col-reverse justify-between text-right text-[11px] tabular-nums text-muted-foreground",
        className,
      )}
    >
      {values.map((value, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static tick list
        <span key={i}>{formatValue(value)}</span>
      ))}
    </div>
  );
}
