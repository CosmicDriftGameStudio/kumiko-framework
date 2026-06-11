// TimestampInput — natives <input type="datetime-local"> mit
// Wert-Konvertierung. Der Server validiert timestamp-Felder als
// ISO-UTC mit `Z` (z.iso.datetime()) bzw. als Wall-Clock ohne Offset
// bei locatedTimestamps (z.iso.datetime({ local: true })). Das native
// datetime-local-Input spricht aber IMMER lokale Wall-Clock ohne
// Offset — ohne Konvertierung ging jeder UTC-Timestamp als
// offset-loser String raus und der Server lehnte mit invalid_format
// ab (Bug-Bash-2, 2026-06-08).

import type { ChangeEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

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
  readonly className?: string;
};

export function TimestampInput({
  id,
  name,
  value,
  onChange,
  wallClock,
  disabled,
  required,
  hasError,
  className,
}: TimestampInputProps): ReactNode {
  return (
    <input
      type="datetime-local"
      id={id}
      name={name}
      disabled={disabled}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      value={timestampToInputValue(value)}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        onChange(inputValueToTimestamp(e.target.value, wallClock === true))
      }
      // Das `flex` der Input-Basisklasse macht die Shadow-DOM-Teile des
      // datetime-local zu Flex-Items — der Picker-Indicator klebt dann
      // direkt am Text statt am rechten Rand. ml-auto schiebt ihn zurück.
      className={cn("[&::-webkit-calendar-picker-indicator]:ml-auto", className)}
    />
  );
}
