import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn.ts";

const CHOICE_COLUMNS_CLASS = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
} as const;

/** Card-styled radio group for mutually exclusive choices that need a description or price line. */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  label,
  columns = 2,
  variant = "check",
  testId,
}: {
  /** `null`: nothing selected. */
  readonly value: T | null;
  readonly options: readonly {
    readonly value: T;
    readonly title: string;
    readonly description?: string;
    /** Right-aligned next to the title, e.g. a price. */
    readonly aside?: string;
    readonly disabled?: boolean;
  }[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  /** Visible group label in the field-label style (13px medium, foreground); names the group instead of `ariaLabel`. */
  readonly label?: string;
  /** Columns from the `sm` breakpoint, default 2. */
  readonly columns?: 1 | 2 | 3 | 4;
  /** `check` (default): check indicator top right. `radio`: radio indicator before the title. */
  readonly variant?: "check" | "radio";
  readonly testId?: string;
}): ReactNode {
  const groupName = useId();
  const labelId = `${groupName}-label`;
  const group = (
    <div
      role="radiogroup"
      aria-label={label === undefined ? ariaLabel : undefined}
      aria-labelledby={label !== undefined ? labelId : undefined}
      data-testid={testId}
      className={cn("grid grid-cols-1 gap-2", CHOICE_COLUMNS_CLASS[columns])}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const indicator =
          variant === "radio" ? (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary" : "border-input",
              )}
            >
              {selected && <span className="size-2 rounded-full bg-primary" />}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
              )}
            >
              {selected && <Check className="size-3" />}
            </span>
          );
        return (
          <label
            key={option.value}
            data-testid={testId !== undefined ? `${testId}-${option.value}` : undefined}
            className={cn(
              "relative flex cursor-pointer flex-col gap-1 rounded-lg border bg-card p-4 transition-colors",
              "hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              selected ? "border-primary ring-1 ring-primary" : "border-border",
              option.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={groupName}
              value={option.value}
              checked={selected}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="flex items-start justify-between gap-2">
              <span className="flex items-center gap-2">
                {variant === "radio" && indicator}
                <span className="font-semibold">{option.title}</span>
              </span>
              <span className="flex items-center gap-2">
                {option.aside !== undefined && (
                  <span className="font-semibold tabular-nums">{option.aside}</span>
                )}
                {variant === "check" && indicator}
              </span>
            </span>
            {option.description !== undefined && (
              <span
                className={cn(
                  "text-sm text-muted-foreground",
                  // Aligns with the title: radio indicator size-4 plus gap-2.
                  variant === "radio" && "pl-6",
                )}
              >
                {option.description}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
  if (label === undefined) return group;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-[13px] leading-none font-medium text-foreground">
        {label}
      </span>
      {group}
    </div>
  );
}
