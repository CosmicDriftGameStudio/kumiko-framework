// CalendarPopover — shared calendar trigger for DateInput and
// TimestampInput. An icon button opens a Radix popover with
// react-day-picker (v9). captionLayout="dropdown" + startMonth/endMonth
// provide month AND year dropdowns instead of only month navigation —
// going back 10 years would otherwise take ~120 clicks. min/max gray out
// days outside the allowed range.
//
// The text input (typing) intentionally lives in each Primitive, not here:
// date has one field, while timestamp has two (date + time). This lets both
// share the calendar mechanics without sharing their input layout.

import { Calendar as CalendarIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { lazy, type ReactNode, Suspense } from "react";
import { cn } from "../lib/cn.ts";

const CalendarDayPicker = lazy(() => import("./calendar-day-picker.tsx"));

// Same footprint as the loaded calendar card, so opening the popover does not jump.
const CALENDAR_PLACEHOLDER_CLASS = "h-[17rem] w-56";

export type CalendarPopoverProps = {
  readonly selected: Date | undefined;
  readonly onSelect: (d: Date | undefined) => void;
  readonly min?: Date;
  readonly max?: Date;
  readonly disabled?: boolean;
  readonly hasError?: boolean;
  /** a11y label for the icon button (no visible text). */
  readonly triggerLabel: string;
};

export const inFieldIconButtonClass =
  "absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center rounded-md " +
  "text-muted-foreground transition-colors hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const popoverClass =
  "z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out " +
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

// Default range when the field does not set min/max; otherwise the year
// dropdown would be empty or unusable. Computed at render time.
function defaultRange(): { start: Date; end: Date } {
  const thisYear = new Date().getFullYear();
  return { start: new Date(1900, 0, 1), end: new Date(thisYear + 10, 11, 31) };
}

export function CalendarPopover({
  selected,
  onSelect,
  min,
  max,
  disabled,
  hasError,
  triggerLabel,
}: CalendarPopoverProps): ReactNode {
  const range = defaultRange();
  const startMonth = min ?? range.start;
  const endMonth = max ?? range.end;
  const disabledMatchers = [
    ...(min !== undefined ? [{ before: min }] : []),
    ...(max !== undefined ? [{ after: max }] : []),
  ];

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={triggerLabel}
          aria-invalid={hasError === true ? true : undefined}
          className={cn(inFieldIconButtonClass, hasError === true && "text-destructive")}
        >
          <CalendarIcon className="size-4" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={popoverClass} align="end" sideOffset={4}>
          <Suspense fallback={<div className={CALENDAR_PLACEHOLDER_CLASS} aria-hidden="true" />}>
            <CalendarDayPicker
              selected={selected}
              onSelect={onSelect}
              startMonth={startMonth}
              endMonth={endMonth}
              disabledMatchers={disabledMatchers}
            />
          </Suspense>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
