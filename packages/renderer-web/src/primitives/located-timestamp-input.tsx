// LocatedTimestampInput (kind:"locatedTimestamp") — Wall-Clock-Eingabe + IANA-
// Zonen-Auswahl für locatedTimestamp-Felder. Anders als TimestampInput findet
// KEINE UTC-Konvertierung statt: ein located Timestamp IST Wall-Clock + Zone;
// der Server rechnet `utc` aus `{ at, tz }`. Datum/Uhrzeit laufen über
// TimestampInput im wallClock-Modus (reine String-Form, kein new Date()), die
// Zone über eine durchsuchbare Combobox der IANA-Zonen.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ComboboxInput } from "./combobox";
import { TimestampInput } from "./timestamp-input";

// Kuratierte Notliste falls die Runtime Intl.supportedValuesOf nicht kennt
// (vor ES2022). Reicht für die häufigsten Zonen; moderne Browser + Bun liefern
// die volle Liste.
const FALLBACK_ZONES: readonly string[] = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "America/New_York",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const TZ_OPTIONS: readonly { readonly value: string; readonly label: string }[] = (
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FALLBACK_ZONES
).map((zone) => ({ value: zone, label: zone }));

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

  // `at` ist Minuten-Wallclock (z.iso.datetime({local:true}) akzeptiert das);
  // tz ein IANA-Name. Solange beides leer ist gilt das Feld als leer; sobald
  // eines gesetzt ist, fließt das Paar — die Vollständigkeit erzwingt die
  // Required-/Zod-Validierung beim Submit (so bleibt eine halbe Eingabe sichtbar).
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
