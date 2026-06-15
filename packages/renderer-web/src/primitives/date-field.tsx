// DateField — die gemeinsame tippbare Datums-Eingabe: ein Text-Input
// (locale-aware Parse, Teil-Eingaben tolerant) plus CalendarPopover mit
// Jahres-/Dekaden-Dropdown. Underlying-Wert ist ISO `yyyy-mm-dd`.
//
// Eine Quelle für beide Date-Primitives: DateInput (kind:"date") ist ein
// dünner Re-Export hiervon, TimestampInput (kind:"timestamp") nutzt es als
// Datums-Teil neben dem Uhrzeit-Input. So teilen `date` und `timestamp`
// dieselbe Tipp-/Navigations-UX statt zweier divergenter Primitives (#369).

import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { CalendarPopover } from "./calendar-popover";
import { formatDateForInput, guessLocale, parseIso, parseTypedDate, toIso } from "./date-parse";

export type DateFieldProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string | undefined) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly locale?: string;
  /** Untere/obere Grenze als ISO `yyyy-mm-dd`. Begrenzt den Kalender
   *  (Jahres-Dropdown-Range + ausgegraute Tage). Server-Validierung läuft
   *  separat über die Zod-Schemas. */
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
  const resolvedLocale = locale ?? guessLocale();
  const selected = parseIso(value);

  // draft === null → zeige den kanonisch formatierten Wert. Sobald der User
  // tippt, hält draft den Roh-Text, damit die Eingabe nicht bei jedem
  // Tastendruck umformatiert wird. onBlur setzt zurück auf null.
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
        placeholder={formatDateForInput(new Date(2026, 11, 31), resolvedLocale)}
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
        selected={selected}
        onSelect={(d) => {
          onChange(d !== undefined ? toIso(d) : undefined);
          setDraft(null);
        }}
        {...(minDate !== undefined && { min: minDate })}
        {...(maxDate !== undefined && { max: maxDate })}
        {...(disabled !== undefined && { disabled })}
        {...(hasError !== undefined && { hasError })}
        triggerLabel="Kalender öffnen"
      />
    </div>
  );
}
