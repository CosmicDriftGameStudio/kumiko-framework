// MoneyInput — type=text mit focus-aware Locale-Format. Canonical-Wert
// bleiben Minor-Units (Cents) wie auf der Wire; während Focus zeigt das
// Input einen rohen, editierbaren Decimal-String. Bei Blur formatiert
// Intl.NumberFormat mit `style: "currency"` — das liefert Currency-
// Symbol (€/$/¥) UND Tausender-Trenner UND korrekte Decimals in einem
// Aufruf.
//
// Warum nicht type=number: number-Inputs lehnen formatierte Strings
// ("1.234,56 €") ab — kein Browser akzeptiert Locale-Decimals (Komma)
// in number-Inputs. inputMode="decimal" gibt mobiles Numpad-Keyboard
// trotzdem.

import { currencyDecimals } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";

// Re-exported for backward compat — callers used to import this from here
// before it moved to headless (shared with RenderField, kumiko-framework#1923).
export { currencyDecimals };

export type MoneyInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: number | "";
  readonly onChange: (v: number | undefined) => void;
  readonly currency: string;
  readonly locale?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
};

// The border and focus ring live on the wrapper so the currency symbol can be
// a flex sibling of the input: a symbol of any width ("€", "CHF", "R$") takes
// its own space instead of overlapping the digits.
const wrapperClass =
  "flex h-9 w-full items-center rounded-md border border-input bg-transparent text-sm shadow-sm " +
  "transition-colors focus-within:ring-1 focus-within:ring-ring";

const inputClass =
  "h-full min-w-0 flex-1 bg-transparent px-3 placeholder:text-muted-foreground " +
  "focus-visible:outline-none disabled:cursor-not-allowed " +
  // Numerische Inputs rechtsbündig — wie native type=number — damit
  // Beträge unter Listen-Spalten an den Tausender-Stellen alignen.
  "text-right tabular-nums";

export function MoneyInput({
  id,
  name,
  value,
  onChange,
  currency,
  locale,
  disabled,
  required,
  hasError,
}: MoneyInputProps): ReactNode {
  const decimals = currencyDecimals(currency);
  const factor = 10 ** decimals;
  const resolvedLocale = locale ?? guessLocale();
  const [focused, setFocused] = useState(false);
  // Raw-Edit-Buffer während Focus. Sonst würde jeder Tipp-Step durch
  // Math.round → format-Roundtrip jagen und der Cursor würde springen.
  const [draft, setDraft] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const major = value === "" ? null : value / factor;
  const { symbol, symbolPosition, formatNumber } = useMemo(
    () => moneyFormatParts(currency, resolvedLocale),
    [currency, resolvedLocale],
  );
  const formatted = value === "" ? "" : formatNumber(value / factor);

  // Edit-Mode: Decimal-String ohne Tausender-Trenner.
  const toEditable = (m: number | null): string =>
    m === null
      ? ""
      : m.toLocaleString(resolvedLocale, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: false,
        });

  const handleFocus = (): void => {
    setDraft(toEditable(major));
    setFocused(true);
  };

  // Select-all-on-focus: deliberate, not just a Playwright accommodation.
  // Focus always swaps the displayed value from the formatted string
  // ("1.234,56 €") to the raw editable one ("1234,56"). Measured in a real
  // browser: on this kind of value swap, the browser collapses the cursor
  // to the *end* of the new value rather than preserving position — so
  // without an explicit re-select, typing right after focus appends
  // instead of replacing. That's what silently corrupted values set via
  // Playwright's `.fill()` (framework#1856). It also matches standard
  // money-input UX (immediate overtype on click), and sidesteps mapping a
  // click position from the formatted view to the editable one, which has
  // no well-defined equivalent once separators and the currency symbol
  // are stripped.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused]);

  const handleBlur = (): void => {
    setFocused(false);
    if (draft.trim() === "") {
      onChange(undefined);
      return;
    }
    const parsed = parseLocaleNumber(draft, resolvedLocale);
    if (Number.isNaN(parsed)) return;
    onChange(Math.round(parsed * factor));
  };

  const symbolEl =
    symbol !== "" ? (
      <span
        id={`${id}-currency`}
        data-testid={`${id}-currency`}
        className={cn(
          "shrink-0 select-none text-muted-foreground",
          symbolPosition === "prefix" ? "pl-3" : "pr-3",
        )}
      >
        {symbol}
      </span>
    ) : null;

  return (
    <div
      className={cn(
        wrapperClass,
        hasError === true && "border-destructive focus-within:ring-destructive",
        disabled === true && "cursor-not-allowed opacity-50",
      )}
    >
      {symbolPosition === "prefix" && symbolEl}
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        aria-required={required}
        aria-invalid={hasError === true ? true : undefined}
        aria-describedby={symbol !== "" ? `${id}-currency` : undefined}
        value={focused ? draft : formatted}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => setDraft(e.target.value)}
        className={cn(inputClass, symbolPosition === "prefix" ? "pl-2" : "pr-2")}
      />
      {symbolPosition === "suffix" && symbolEl}
    </div>
  );
}

function guessLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}

// Shared with defaultCellRender (index.tsx) so both formatting paths stay
// identical instead of drifting. currency is validated against the
// 3-letter-alpha shape Intl.NumberFormat requires — a non-conforming
// value (e.g. from a JSONB custom field that never ran through
// rehydrateMoney) throws a RangeError inside Intl.NumberFormat, and with
// no ErrorBoundary in this render tree that would take down the whole
// page instead of just this cell.
export function formatMoney(amountMinor: number, currency: string, locale?: string): string {
  if (!/^[A-Za-z]{3}$/.test(currency)) return String(amountMinor);
  const decimals = currencyDecimals(currency);
  const resolvedLocale = locale ?? guessLocale();
  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amountMinor / 10 ** decimals);
}

// The currency symbol is rendered as a separate adornment, so the field
// value shows only the grouped number. Position follows the locale's pattern.
function moneyFormatParts(
  currency: string,
  locale: string,
): {
  readonly symbol: string;
  readonly symbolPosition: "prefix" | "suffix";
  readonly formatNumber: (major: number) => string;
} {
  if (!/^[A-Za-z]{3}$/.test(currency)) {
    return { symbol: "", symbolPosition: "suffix", formatNumber: String };
  }
  const decimals = currencyDecimals(currency);
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const sample = formatter.formatToParts(1);
    const symbolIndex = sample.findIndex((p) => p.type === "currency");
    const integerIndex = sample.findIndex((p) => p.type === "integer");
    return {
      symbol: sample[symbolIndex]?.value ?? currency,
      symbolPosition: symbolIndex !== -1 && symbolIndex < integerIndex ? "prefix" : "suffix",
      formatNumber: (major) =>
        formatter
          .formatToParts(major)
          .filter((p) => p.type !== "currency")
          .map((p) => p.value)
          .join("")
          .trim(),
    };
  } catch {
    // An invalid locale tag makes Intl throw a RangeError; without an
    // ErrorBoundary that would take down the page over a display adornment.
    return { symbol: "", symbolPosition: "suffix", formatNumber: String };
  }
}

// Locale-Decimal-Parse: erkennt automatisch ob Komma oder Punkt der
// Decimal-Separator ist. Intl.NumberFormat liefert die Trenner für
// das Locale, daraus bauen wir den Reverse-Parser. Strict beim
// Vorzeichen: ein `-` darf NUR ganz vorne stehen — `1-23` ist invalid,
// nicht `-123` (sonst würden vertippte Inputs zu falschen Beträgen).
export function parseLocaleNumber(raw: string, locale: string): number {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const groupSep = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimalSep = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  // Body darf nur noch Ziffern, Group- und Decimal-Separator enthalten.
  // Alles andere (zweites Minus, Buchstaben, etc.) → NaN, damit Caller
  // (handleBlur) den Wert verwirft statt eine korrupte Zahl zu setzen.
  const cleaned = body.split(groupSep).join("").split(decimalSep).join(".");
  if (!/^[0-9]*\.?[0-9]*$/.test(cleaned) || cleaned === "" || cleaned === ".") return Number.NaN;
  const n = Number(cleaned);
  return negative ? -n : n;
}
