// LocatedTimestampInput (kind:"locatedTimestamp") — Wall-clock input + IANA
// zone selection for locatedTimestamp fields. Unlike TimestampInput, it performs
// NO UTC conversion: a located timestamp IS wall-clock time + zone;
// the server calculates `utc` from `{ at, tz }`. Date/time use
// TimestampInput in wallClock mode (a plain string form, no new Date()), while
// the zone uses a searchable combobox of IANA zones.

import type { ReactNode } from "react";
import { useTranslation } from "../../index.ts";
import { ComboboxInput } from "./combobox.tsx";
import { TimestampInput } from "./timestamp-input.tsx";
import { TZ_OPTIONS } from "./tz-options.ts";

export type LocatedTimestampValue = {
  readonly at: string;
  readonly tz: string;
  readonly utc?: string;
};

export type LocatedTimestampInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: LocatedTimestampValue | "";
  readonly onChange: (v: { readonly at: string; readonly tz: string } | undefined) => void;
  readonly locale?: string;
  readonly min?: string;
  readonly max?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
};

export function LocatedTimestampInput({
  id,
  name,
  value,
  onChange,
  locale,
  min,
  max,
  disabled,
  required,
  hasError,
}: LocatedTimestampInputProps): ReactNode {
  const t = useTranslation();
  const at = value === "" ? "" : value.at;
  const tz = value === "" ? "" : value.tz;

  // `at` is a minute-precision wall-clock value (z.iso.datetime({local:true}) accepts it);
  // tz is an IANA name. The field is empty while both are empty; once either
  // is set, the pair is emitted — Required/Zod validation on submit enforces
  // completeness (so a partial input remains visible).
  function emit(nextAt: string, nextTz: string): void {
    if (nextAt === "" && nextTz === "") {
      onChange(undefined);
      return;
    }
    onChange({ at: nextAt, tz: nextTz });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <TimestampInput
          id={id}
          name={name}
          value={at}
          onChange={(v) => emit(v ?? "", tz)}
          wallClock
          {...(locale !== undefined && { locale })}
          {...(min !== undefined && { min })}
          {...(max !== undefined && { max })}
          {...(disabled !== undefined && { disabled })}
          {...(required !== undefined && { required })}
          {...(hasError !== undefined && { hasError })}
        />
        <div className="min-w-[12rem]">
          <ComboboxInput
            id={`${id}-tz`}
            name={`${name}-tz`}
            options={TZ_OPTIONS}
            value={tz}
            onChange={(v) => emit(at, v)}
            placeholder={t("kumiko.field.timezone")}
            {...(disabled !== undefined && { disabled })}
            {...(required !== undefined && { required })}
            {...(hasError !== undefined && { hasError })}
          />
        </div>
      </div>
      <span className="text-xs text-muted-foreground">{t("kumiko.field.locatedTzHint")}</span>
    </div>
  );
}
