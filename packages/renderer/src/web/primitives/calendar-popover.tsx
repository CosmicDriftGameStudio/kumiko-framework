// CalendarPopover — gemeinsamer Kalender-Trigger für DateInput und
// TimestampInput. Ein Icon-Button öffnet ein Radix-Popover mit
// react-day-picker (v9). captionLayout="dropdown" + startMonth/endMonth
// geben Monats- UND Jahres-Dropdown statt nur Monats-Vor/Zurück — der
// Grund für #369 (10 Jahre zurück war ~120 Klicks). min/max grauen
// Tage außerhalb des erlaubten Bereichs aus.
//
// Der Text-Input (Tippen) lebt bewusst NICHT hier, sondern im jeweiligen
// Primitive — date hat ein Feld, timestamp zwei (Datum + Uhrzeit). So
// teilen beide dieselbe Kalender-Mechanik ohne ihre Eingabe-Form zu teilen.

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Calendar as CalendarIcon } from "lucide-react";
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
  /** a11y-Label für den Icon-Button (kein sichtbarer Text). */
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

// Default-Range wenn das Feld kein min/max setzt — sonst wäre das
// Jahres-Dropdown leer/unbrauchbar. Zur Render-Zeit berechnet.
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
