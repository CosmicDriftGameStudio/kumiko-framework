import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type ModeSwitchVariant = "outline" | "pill";

/** Segmented control for mutually exclusive modes—the prominent
 * alternative to the buried <select>. */
export function ModeSwitch<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = "outline",
  className,
  testId,
}: {
  /** `null`: no option active. */
  readonly value: T | null;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    /** Muted tabular counter after the label. */
    readonly count?: number;
    /** Not selectable: aria-disabled, muted, no click. */
    readonly disabled?: boolean;
    /** `warning` frames the option to flag an open question. */
    readonly tone?: "warning";
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
    // biome-ignore lint/a11y/useSemanticElements: fieldset brings browser-default chrome (border/legend) that is wrong for a button segmented control
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
        const disabled = o.disabled === true;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) onChange(o.value);
            }}
            className={cn(
              "grow px-3 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              disabled && "cursor-not-allowed opacity-50",
              o.tone === "warning" && "ring-1 ring-inset ring-status-warn",
              pill
                ? [
                    "rounded-md",
                    active
                      ? "bg-card font-semibold text-foreground shadow-sm dark:bg-foreground/10"
                      : cn("text-muted-foreground", !disabled && "hover:text-foreground"),
                  ]
                : [
                    "border-l border-input first:border-l-0",
                    active
                      ? "bg-primary/10 font-semibold text-primary"
                      : disabled
                        ? "text-muted-foreground"
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
