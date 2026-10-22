import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "../lib/cn.ts";

/** Card-styled radio group for mutually exclusive choices that need a description or price line. */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
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
  readonly testId?: string;
}): ReactNode {
  const groupName = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {options.map((option) => {
        const selected = option.value === value;
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
              <span className="font-semibold">{option.title}</span>
              <span className="flex items-center gap-2">
                {option.aside !== undefined && (
                  <span className="font-semibold tabular-nums">{option.aside}</span>
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                >
                  {selected && <Check className="size-3" />}
                </span>
              </span>
            </span>
            {option.description !== undefined && (
              <span className="text-sm text-muted-foreground">{option.description}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
