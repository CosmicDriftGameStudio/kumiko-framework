import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type ChartSwatchKind = "area" | "line" | "dashed-line";

export function ChartSwatch({
  color,
  swatch,
  className,
}: {
  readonly color: string;
  readonly swatch: ChartSwatchKind;
  readonly className?: string;
}): ReactNode {
  if (swatch === "area") {
    return (
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-[2px]", className)}
        style={{ backgroundColor: color }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn("w-3 border-t-2", className)}
      style={{
        borderColor: color,
        borderTopStyle: swatch === "dashed-line" ? "dashed" : "solid",
      }}
    />
  );
}

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
    readonly swatch?: ChartSwatchKind;
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
          <ChartSwatch color={item.color} swatch={item.swatch ?? "area"} />
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
