import type { ReactNode } from "react";
import { usePrimitives } from "../../index.ts";

export type ComposerProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Accessible name of the send button (icon-only). */
  readonly submitLabel: string;
  readonly rows?: number;
  readonly testId?: string;
};

/** Chat input: a label-less textarea with the send button inside the field frame, bottom right.
 *  Docks to the bottom of its column (`mt-auto` in a flex column, sticky otherwise). */
export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  submitLabel,
  rows = 2,
  testId,
}: ComposerProps): ReactNode {
  const { Button } = usePrimitives();
  return (
    <div data-testid={testId} className="sticky bottom-0 mt-auto bg-background pt-2">
      <div className="flex flex-col rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
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
            icon="send"
            ariaLabel={submitLabel}
            size="icon"
            disabled={disabled === true || value.trim() === ""}
            onClick={onSubmit}
            {...(testId !== undefined && { testId: `${testId}-submit` })}
          />
        </div>
      </div>
    </div>
  );
}
