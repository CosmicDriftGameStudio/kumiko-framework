import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Segmented-Control für sich ausschließende Modi — die prominente
 *  Alternative zum vergrabenen <select>. */
export function ModeSwitch<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly testId?: string;
}): ReactNode {
  return (
    <div data-testid={testId} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-transparent bg-secondary font-semibold text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
