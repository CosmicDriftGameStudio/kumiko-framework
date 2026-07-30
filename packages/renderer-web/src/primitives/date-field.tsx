// DateField — the shared typable date input: a text input (locale-aware
// parse, tolerant of partial input) plus a CalendarPopover with year/
// decade dropdown. Underlying value is ISO `yyyy-mm-dd`.
//
// One source for both date primitives: DateInput (kind:"date") is a thin
// re-export of this, TimestampInput (kind:"timestamp") uses it as the
// date part next to the time input. So `date` and `timestamp` share the
// same typing/navigation UX instead of two diverging primitives (#369).

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { cn } from "../lib/cn";
import { CalendarPopover } from "./calendar-popover";
import { formatDateForInput, guessLocale, parseIso, parseTypedDate, toIso } from "./date-parse";

// CalendarPopover wraps react-day-picker, which only accepts native Date
// objects — the PlainDate↔Date boundary conversion stays confined to
// these two functions instead of spreading through the rest of the field.
function toNativeDate(pd: Temporal.PlainDate): Date {
  return new Date(pd.year, pd.month - 1, pd.day);
}

function fromNativeDate(d: Date): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  });
}

export type DateFieldProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string | undefined) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly locale?: string;
  /** Lower/upper bound as ISO `yyyy-mm-dd`. Limits the calendar
   *  (year-dropdown range + greyed-out days). Server-side validation runs
   *  separately via the Zod schemas. */
  readonly min?: string;
  readonly max?: string;
};

const inputClass =
  "flex h-9 w-full items-center rounded-md border border-input bg-transparent " +
  "px-3 py-1 text-sm shadow-sm transition-colors " +
  "placeholder:text-muted-foreground " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function DateField({
  id,
  name,
  value,
  onChange,
  disabled,
  required,
  hasError,
  locale,
  min,
  max,
}: DateFieldProps): ReactNode {
  const t = useTranslation();
  const resolvedLocale = locale ?? guessLocale();
  const selected = parseIso(value);

  // draft === null → show the canonically formatted value. Once the user
  // types, draft holds the raw text so input isn't reformatted on every
  // keystroke. onBlur resets it back to null.
  const [draft, setDraft] = useState<string | null>(null);
  const display =
    draft ?? (selected !== undefined ? formatDateForInput(selected, resolvedLocale) : "");

  function commitTyped(raw: string): void {
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const parsed = parseTypedDate(raw, resolvedLocale);
    if (parsed !== undefined) onChange(toIso(parsed));
  }

  const minDate = min !== undefined ? parseIso(min) : undefined;
  const maxDate = max !== undefined ? parseIso(max) : undefined;

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        id={id}
        name={name}
        value={display}
        disabled={disabled}
        required={required}
        aria-invalid={hasError === true ? true : undefined}
        placeholder={formatDateForInput(
          Temporal.PlainDate.from({ year: 2026, month: 12, day: 31 }),
          resolvedLocale,
        )}
        onChange={(e) => {
          setDraft(e.target.value);
          commitTyped(e.target.value);
        }}
        onBlur={() => setDraft(null)}
        className={cn(
          inputClass,
          hasError === true && "border-destructive focus-visible:ring-destructive",
        )}
      />
      <CalendarPopover
        selected={selected !== undefined ? toNativeDate(selected) : undefined}
        onSelect={(d) => {
          onChange(d !== undefined ? toIso(fromNativeDate(d)) : undefined);
          setDraft(null);
        }}
        {...(minDate !== undefined && { min: toNativeDate(minDate) })}
        {...(maxDate !== undefined && { max: toNativeDate(maxDate) })}
        {...(disabled !== undefined && { disabled })}
        {...(hasError !== undefined && { hasError })}
        triggerLabel={t("kumiko.field.open-calendar")}
      />
    </div>
  );
}
