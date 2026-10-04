import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export type ModeSwitchVariant = "outline" | "pill";

/** Segmented-Control für sich ausschließende Modi — die prominente
 *  Alternative zum vergrabenen <select>. */
export function ModeSwitch<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = "outline",
  className,
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
  /** `outline` (default): bordered segments, active tinted. `pill`: grey
   *  track with a raised active segment. */
  readonly variant?: ModeSwitchVariant;
  readonly className?: string;
  readonly testId?: string;
}): ReactNode {
  const pill = variant === "pill";
  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset bringt Browser-Default-Chrome (Border/legend) mit, das für ein Button-Segmented-Control falsch ist
    <div
      data-testid={testId}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex min-h-8",
        pill
          ? "gap-0.5 rounded-lg bg-muted p-0.5"
          : "overflow-hidden rounded-md border border-input bg-background",
        className,
      )}
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
              "grow px-3 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              pill
                ? [
                    "rounded-md",
                    active
                      ? "bg-background font-semibold text-foreground shadow-sm dark:bg-card"
                      : "text-muted-foreground hover:text-foreground",
                  ]
                : [
                    "border-l border-input first:border-l-0",
                    active
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-foreground hover:bg-muted",
                  ],
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
