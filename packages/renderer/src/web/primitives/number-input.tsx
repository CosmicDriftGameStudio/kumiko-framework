// NumberInput — type=text with a focus-aware locale format, so a blurred
// value shows thousands separators ("28.000") while editing shows the raw
// locale string ("28000"). Not type=number: browsers reject formatted
// strings and locale decimal commas there. The parent value is updated while
// typing (every parseable draft), so submit shortcuts that skip blur still
// see the typed value; blur only normalizes the display. A draft that does
// not parse clears the value, so the parent never holds a stale prefix.

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { Input as UiInput } from "../ui/input.tsx";
import { formatLocaleNumber, parseLocaleNumber, resolveSafeLocale } from "./locale-number.ts";

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
  readonly ariaDescribedBy?: string;
  readonly ariaLabel?: string;
};

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
  ariaDescribedBy,
  ariaLabel,
}: NumberInputProps): ReactNode {
  const resolvedLocale = resolveSafeLocale(locale);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus swaps the displayed value ("10.000" → "10000") and the browser then
  // collapses the cursor to the end, so typing or Playwright's fill() would
  // append instead of replace. Select-all-on-focus matches MoneyInput; a click
  // therefore does not place the caret.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused]);

  const format = (useGrouping: boolean): string =>
    value === "" ? "" : formatLocaleNumber(value, resolvedLocale, { grouping: useGrouping });

  const handleChange = (raw: string): void => {
    setDraft(raw);
    if (raw.trim() === "") {
      onChange(undefined);
      return;
    }
    const parsed = parseLocaleNumber(raw, resolvedLocale);
    // An unparseable draft clears the value instead of leaving the last
    // parseable prefix behind ("12abc" must not keep submitting 12).
    if (Number.isNaN(parsed) || (integer && !Number.isInteger(parsed))) {
      onChange(undefined);
      return;
    }
    onChange(parsed);
  };

  return (
    <UiInput
      ref={inputRef}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      autoComplete="off"
      id={id}
      name={name}
      disabled={disabled}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
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
