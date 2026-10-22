// TimestampInput (kind:"timestamp") — shared date input (DateField,
// typing + year calendar) plus a time input. This replaced the native
// <input type="datetime-local">: it was typeable, but had an unstyleable
// browser picker without year navigation and diverged from DateInput.
//
// Wire conversion remains unchanged: the server validates timestamp values
// as ISO UTC with `Z` (z.iso.datetime()) or as an offset-free wall clock for
// locatedTimestamps (z.iso.datetime({ local: true })). Internally, the
// datetime-local form `yyyy-MM-ddTHH:mm` is used; timestampToInputValue /
// inputValueToTimestamp encapsulate the UTC↔wall-clock conversion and are
// tested separately.

import { type ReactNode, useState } from "react";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { DateField } from "./date-field.tsx";

const LOCAL_MINUTES = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Form state → datetime-local format (`yyyy-MM-ddTHH:mm`).
 *  UTC instants (with `Z`/offset) are converted to the local wall clock;
 *  offset-free values are only truncated to minutes. */
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

/** datetime-local value → wire format. wallClock=true passes the wall clock
 *  through unchanged; otherwise the local time is emitted as a UTC instant
 *  with a `Z` suffix. */
export function inputValueToTimestamp(raw: string, wallClock: boolean): string | undefined {
  if (raw === "") return undefined;
  if (wallClock) return raw;
  // An offset-free datetime string is parsed by Date as LOCAL time
  // (ES2020+), matching the semantics provided by datetime-local.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  // Seconds are mandatory: write schemas validate offset-bearing timestamps
  // with z.iso.datetime(), which requires `HH:mm:ssZ`.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
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
  readonly ariaLabel?: string;
  readonly locale?: string;
  /** Lower and upper bounds as ISO datetimes. The calendar is constrained to
   *  day-level granularity; Zod validation enforces the exact time bounds.
   */
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
  ariaLabel,
  locale,
  min,
  max,
}: TimestampInputProps): ReactNode {
  const t = useTranslation();
  const local = timestampToInputValue(value);
  const isoDate = local !== "" ? local.slice(0, 10) : "";
  // A time without a selected date would be lost from the wire value, so keep
  // it locally until a date is selected. Once `value` contains a date, its
  // time takes precedence.
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
        {...(ariaLabel !== undefined && { ariaLabel })}
      />
      <input
        type="time"
        aria-label={t("kumiko.field.time")}
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
