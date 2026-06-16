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
import type { ReactElement, ReactNode } from "react";
import { DayPicker, type DropdownProps } from "react-day-picker";
import { cn } from "../lib/cn";

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

const triggerClass =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input " +
  "bg-transparent text-muted-foreground shadow-sm transition-colors hover:bg-accent " +
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
          className={cn(triggerClass, hasError === true && "border-destructive")}
        >
          <CalendarIcon className="size-4" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={popoverClass} align="end" sideOffset={4}>
          <DayPicker
            mode="single"
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            selected={selected}
            // Ohne defaultMonth zeigt DayPicker today statt selected —
            // unintuitiv wenn der User schon ein Datum gewählt hat.
            defaultMonth={selected}
            {...(disabledMatchers.length > 0 && { disabled: disabledMatchers })}
            onSelect={(d) => onSelect(d)}
            classNames={dayPickerClasses}
            components={{ Dropdown: SelectDropdown }}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

const dropdownSelectClass =
  "rounded-sm border border-input bg-transparent px-1.5 py-0.5 text-sm font-medium " +
  "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// rdp v9s Default-Dropdown rendert NEBEN dem <select> ein aria-hidden
// <span> mit demselben Label — sichtbar nur, wenn rdps eigene style.css
// das <select> transparent darüberlegt. Da wir die rdp-Klassen mit eigenen
// Tokens überschreiben, greift diese Positionierung nicht → Label doppelt
// (#369-Folgebug). Ein nacktes <select> ohne Begleit-Span vermeidet das
// CSS-unabhängig — eine Quelle für den sichtbaren Wert.
function SelectDropdown({
  options,
  className,
  ...selectProps
}: DropdownProps): ReactElement {
  return (
    <select className={cn(dropdownSelectClass, className)} {...selectProps}>
      {options?.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// classNames-Map für react-day-picker v9 — überschreibt die default-
// Klassen mit Tailwind/shadcn-Tokens. Die Monat-/Jahr-Selects rendert
// SelectDropdown (components-Prop), daher hier nur der dropdowns-Container.
const dayPickerClasses = {
  root: "rdp-root",
  months: "flex flex-col gap-2",
  month: "flex flex-col gap-2",
  month_caption: "flex justify-center items-center h-7 text-sm font-medium",
  dropdowns: "flex items-center gap-1 text-sm font-medium",
  nav: "flex items-center gap-1 absolute right-1 top-2",
  button_previous: "inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-accent",
  button_next: "inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-accent",
  weekdays: "flex",
  weekday: "w-8 text-xs font-normal text-muted-foreground",
  week: "flex mt-1",
  day: "w-8 h-8 p-0 text-sm",
  day_button:
    "inline-flex h-8 w-8 items-center justify-center rounded-sm hover:bg-accent " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  selected:
    "[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:hover:bg-primary/90",
  today: "[&_button]:underline",
  outside: "text-muted-foreground/50",
  disabled: "text-muted-foreground/30 pointer-events-none",
};
