import type { ReactNode } from "react";
import { usePrimitives } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { screenDockedBottomClassName } from "../primitives/layout.tsx";

export type ComposerProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Text of the send button. */
  readonly submitLabel: string;
  /** Sticks to the bottom of a full-height flex-column parent so it stays visible while the thread scrolls; it also covers the bottom padding of the screen scroll. */
  readonly docked?: boolean;
  readonly rows?: number;
  readonly testId?: string;
};

/** Chat input: a label-less textarea with a text send button inside the field frame, bottom right. */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  submitLabel,
  docked,
  rows = 2,
  testId,
}: ComposerProps): ReactNode {
  const { Button } = usePrimitives();
  return (
    <div data-testid={testId} className={cn(docked === true && screenDockedBottomClassName)}>
      <div className="flex flex-col rounded-md border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
        <textarea
          value={value}
          rows={rows}
          disabled={disabled}
          aria-label={placeholder ?? submitLabel}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-none bg-transparent px-3 pt-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          {...(placeholder !== undefined && { placeholder })}
        />
        <div className="flex justify-end p-1.5">
          <Button
            size="sm"
            disabled={disabled === true || value.trim() === ""}
            onClick={onSubmit}
            {...(testId !== undefined && { testId: `${testId}-submit` })}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
