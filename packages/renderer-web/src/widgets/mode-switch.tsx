import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** Segmented-Control für sich ausschließende Modi — die prominente
 *  Alternative zum vergrabenen <select>. */
export function ModeSwitch<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
}: {
  readonly value: T;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    /** Muted tabular counter after the label. */
    readonly count?: number;
  }[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  readonly testId?: string;
}): ReactNode {
  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset bringt Browser-Default-Chrome (Border/legend) mit, das für ein Button-Segmented-Control falsch ist
    <div
      data-testid={testId}
      role="group"
      aria-label={ariaLabel}
      className="flex min-h-8 overflow-hidden rounded-md border border-input bg-background"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "grow border-l border-input px-3 text-sm transition-colors first:border-l-0",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "bg-primary/10 font-semibold text-primary"
                : "text-foreground hover:bg-muted",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                data-testid={testId !== undefined ? `${testId}-count-${o.value}` : undefined}
                className={cn(
                  "ml-1.5 font-normal tabular-nums",
                  !active && "text-muted-foreground",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
