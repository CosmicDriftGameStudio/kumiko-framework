// NumberInput — type=text with a focus-aware locale format, so a blurred
// value shows thousands separators ("28.000") while editing shows the raw
// locale string ("28000"). Not type=number: browsers reject formatted
// strings and locale decimal commas there. The parent value is updated while
// typing (every parseable draft), so submit shortcuts that skip blur still
// see the typed value; blur only normalizes the display.

import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { Input as UiInput } from "../ui/input.js";
import { parseLocaleNumber, resolveSafeLocale } from "./locale-number.js";

export type NumberInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: number | "";
  readonly onChange: (v: number | undefined) => void;
  readonly locale?: string;
  readonly grouping?: boolean;
  readonly integer?: boolean;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly placeholder?: string;
  readonly testId?: string;
  readonly className?: string;
};

// 20 is the Intl maximum: the display must never round a stored value.
const MAX_FRACTION_DIGITS = 20;

export function NumberInput({
  id,
  name,
  value,
  onChange,
  locale,
  grouping = true,
  integer = false,
  disabled,
  required,
  hasError,
  placeholder,
  testId,
  className,
}: NumberInputProps): ReactNode {
  const resolvedLocale = resolveSafeLocale(locale);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const format = (useGrouping: boolean): string =>
    value === ""
      ? ""
      : new Intl.NumberFormat(resolvedLocale, {
          maximumFractionDigits: MAX_FRACTION_DIGITS,
          useGrouping,
        }).format(value);

  const handleChange = (raw: string): void => {
    setDraft(raw);
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const parsed = parseLocaleNumber(raw, resolvedLocale);
    if (Number.isNaN(parsed) || (integer && !Number.isInteger(parsed))) return;
    onChange(parsed);
  };

  return (
    <UiInput
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      autoComplete="off"
      id={id}
      name={name}
      disabled={disabled}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      data-testid={testId}
      value={focused ? draft : format(grouping)}
      onFocus={() => {
        setDraft(format(false));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => handleChange(e.target.value)}
      {...(placeholder !== undefined && { placeholder })}
      className={cn("text-left tabular-nums", className)}
    />
  );
}
