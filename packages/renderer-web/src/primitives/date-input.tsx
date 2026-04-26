// DateInput — Radix-Popover + react-day-picker. Trigger ist ein
// Button im Input-Style der das formatierte Datum zeigt; Popover
// öffnet eine Calendar-Sheet zur Auswahl. Underlying-Wert bleibt
// ISO `yyyy-mm-dd` damit Server-/Wire-Serialisierung unverändert
// funktioniert.
//
// Warum nicht type=date: Native date-Inputs sehen je nach Browser/OS
// völlig anders aus, der Picker-Overlay ist nicht stylebar, und der
// Format-Match ist Locale-spezifisch außerhalb unserer Kontrolle.
// Mit Popover + Calendar haben wir konsistentes Linear-Look-and-Feel.

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "../lib/cn";

export type DateInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string | undefined) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly locale?: string;
};

const triggerClass =
  "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent " +
  "px-3 py-1 text-sm shadow-sm transition-colors text-left " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const popoverClass =
  "z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out " +
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

export function DateInput({
  id,
  name,
  value,
  onChange,
  disabled,
  required,
  hasError,
  locale,
}: DateInputProps): ReactNode {
  const [open, setOpen] = useState(false);
  const resolvedLocale = locale ?? guessLocale();
  const selected = parseIso(value);

  const display =
    selected !== undefined
      ? selected.toLocaleDateString(resolvedLocale, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "";

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          disabled={disabled}
          // aria-required wird auf <button> nicht unterstützt — stattdessen
          // markiert <Field>-Label das Required mit "*" für Sehende und
          // gibt den Status über aria-invalid (bei Fehler) durch.
          data-required={required === true ? "true" : undefined}
          aria-invalid={hasError === true ? true : undefined}
          className={cn(
            triggerClass,
            hasError === true && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <span className={cn(display === "" && "text-muted-foreground")}>
            {display === "" ? "—" : display}
          </span>
          <CalendarIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={popoverClass} align="start" sideOffset={4}>
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(d) => {
              onChange(d !== undefined ? toIso(d) : undefined);
              setOpen(false);
            }}
            classNames={dayPickerClasses}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// classNames-Map für react-day-picker v9 — überschreibt die default-
// Klassen mit Tailwind/shadcn-Tokens. Nur die wichtigsten Slots; der
// Rest erbt die rdp-Default-Styles. Padding/Größen sind klein gehalten
// damit der Popover nicht das halbe Viewport einnimmt.
const dayPickerClasses = {
  root: "rdp-root",
  months: "flex flex-col gap-2",
  month: "flex flex-col gap-2",
  month_caption: "flex justify-center items-center h-7 text-sm font-medium",
  caption_label: "text-sm font-medium",
  nav: "flex items-center gap-1 absolute right-3 top-3",
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

function parseIso(v: string): Date | undefined {
  if (v === "") return undefined;
  // Date(yyyy-mm-dd) parses as UTC — wir wollen local damit "2026-04-25"
  // im Calendar nicht je nach Timezone als 24. oder 25. erscheint.
  const parts = v.split("-");
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  )
    return undefined;
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function guessLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}
