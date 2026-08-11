// TzInput (kind:"tz") — standalone IANA-zone picker for `tz`-typed fields
// (#1925). Same searchable-combobox UX as the zone half of
// LocatedTimestampInput, shared TZ_OPTIONS source.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { ComboboxInput } from "./combobox";
import { TZ_OPTIONS } from "./tz-options";

export type TzInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string | undefined) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
};

export function TzInput({
  id,
  name,
  value,
  onChange,
  disabled,
  required,
  hasError,
}: TzInputProps): ReactNode {
  const t = useTranslation();
  return (
    <ComboboxInput
      id={id}
      name={name}
      options={TZ_OPTIONS}
      value={value}
      onChange={(v) => onChange(v === "" ? undefined : v)}
      placeholder={t("kumiko.field.timezone")}
      {...(disabled !== undefined && { disabled })}
      {...(required !== undefined && { required })}
      {...(hasError !== undefined && { hasError })}
    />
  );
}
