// TimestampInput (kind:"timestamp") — gemeinsame Datums-Eingabe (DateField,
// Tippen + Jahres-Kalender) plus ein Uhrzeit-Input. Bis #369 war dies ein
// natives <input type="datetime-local"> — tippbar, aber mit nicht-stylebarem
// Browser-Picker ohne Jahres-Navigation und divergent zu DateInput.
//
// Die Wire-Konvertierung bleibt unverändert: der Server validiert timestamp
// als ISO-UTC mit `Z` (z.iso.datetime()) bzw. als Wall-Clock ohne Offset bei
// locatedTimestamps (z.iso.datetime({ local: true })). Intern rechnen wir
// über die datetime-local-Form `yyyy-MM-ddTHH:mm`; timestampToInputValue /
// inputValueToTimestamp kapseln die UTC↔Wall-Clock-Umrechnung (Bug-Bash-2,
// 2026-06-08) und sind separat getestet.

import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { DateField } from "./date-field";

const LOCAL_MINUTES = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Form-State → datetime-local-Format (`yyyy-MM-ddTHH:mm`).
 *  UTC-Instants (mit `Z`/Offset) werden in lokale Wall-Clock
 *  umgerechnet; offset-lose Werte nur auf Minuten gekürzt. */
export function timestampToInputValue(value: string): string {
  if (value === "") return "";
  if (HAS_OFFSET.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const m = LOCAL_MINUTES.exec(value);
  return m !== null ? m[0] : "";
}

/** datetime-local-Wert → Wire-Format. wallClock=true reicht die
 *  Wall-Clock unverändert durch; sonst wird die lokale Zeit als
 *  UTC-Instant mit `Z`-Suffix emittiert. */
export function inputValueToTimestamp(raw: string, wallClock: boolean): string | undefined {
  if (raw === "") return undefined;
  if (wallClock) return raw;
  // Offset-loser Datetime-String wird von Date als LOKALE Zeit geparst
  // (ES2020+) — genau die Semantik die datetime-local liefert.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

export type TimestampInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string | undefined) => void;
  readonly wallClock?: boolean;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly locale?: string;
  /** Untere/obere Grenze als ISO-Datetime. Begrenzt den Kalender auf
   *  Tages-Granularität; die exakte Uhrzeit-Grenze setzt die Zod-Validierung
   *  durch. */
  readonly min?: string;
  readonly max?: string;
};

const timeInputClass =
  "h-9 w-[7.5rem] shrink-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm " +
  "shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function toDatePart(iso: string | undefined): string | undefined {
  if (iso === undefined || iso === "") return undefined;
  const v = timestampToInputValue(iso).slice(0, 10);
  return v !== "" ? v : undefined;
}

export function TimestampInput({
  id,
  name,
  value,
  onChange,
  wallClock,
  disabled,
  required,
  hasError,
  locale,
  min,
  max,
}: TimestampInputProps): ReactNode {
  const local = timestampToInputValue(value);
  const isoDate = local !== "" ? local.slice(0, 10) : "";
  // Uhrzeit ohne gesetztes Datum würde im Wire-Wert verschwinden — lokal
  // halten, bis ein Datum gewählt ist. Sobald `value` ein Datum trägt, ist
  // dessen Uhrzeit maßgeblich.
  const [timeText, setTimeText] = useState("");
  const effectiveTime = local !== "" ? local.slice(11, 16) : timeText;

  function emit(nextIsoDate: string, nextTime: string): void {
    if (nextIsoDate === "") {
      onChange(undefined);
      return;
    }
    const localStr = `${nextIsoDate}T${nextTime === "" ? "00:00" : nextTime}`;
    onChange(inputValueToTimestamp(localStr, wallClock === true));
  }

  const minPart = toDatePart(min);
  const maxPart = toDatePart(max);

  return (
    <div className="flex items-center gap-2">
      <DateField
        id={id}
        name={name}
        value={isoDate}
        onChange={(d) => emit(d ?? "", effectiveTime)}
        {...(locale !== undefined && { locale })}
        {...(minPart !== undefined && { min: minPart })}
        {...(maxPart !== undefined && { max: maxPart })}
        {...(disabled !== undefined && { disabled })}
        {...(required !== undefined && { required })}
        {...(hasError !== undefined && { hasError })}
      />
      <input
        type="time"
        aria-label="Uhrzeit"
        disabled={disabled}
        aria-invalid={hasError === true ? true : undefined}
        value={effectiveTime}
        onChange={(e) => {
          setTimeText(e.target.value);
          if (isoDate !== "") emit(isoDate, e.target.value);
        }}
        className={cn(
          timeInputClass,
          hasError === true && "border-destructive focus-visible:ring-destructive",
        )}
      />
    </div>
  );
}
