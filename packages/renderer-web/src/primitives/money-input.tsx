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
//
// +/- Buttons mutieren den Canonical-Wert direkt (1 Major-Unit pro
// Klick — also 100 cents bei EUR/USD, 1 yen bei JPY). User der nur
// Cent-genaue Steps will tippt halt im Focus-Modus.

import { Minus, Plus } from "lucide-react";
import { type FocusEvent, type ReactNode, useState } from "react";
import { cn } from "../lib/cn";

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

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent pl-3 pr-1 text-sm shadow-sm " +
  "transition-colors placeholder:text-muted-foreground focus-visible:outline-none " +
  "focus-visible:ring-1 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const stepBtnClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground " +
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none";

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

  const major = value === "" ? null : value / factor;

  const formatted =
    major === null
      ? ""
      : new Intl.NumberFormat(resolvedLocale, {
          style: "currency",
          currency,
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(major);

  const editable = focused
    ? draft
    : major === null
      ? ""
      : major.toLocaleString(resolvedLocale, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: false,
        });

  const handleFocus = (_e: FocusEvent<HTMLInputElement>): void => {
    setDraft(
      major === null
        ? ""
        : major.toLocaleString(resolvedLocale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: false,
          }),
    );
    setFocused(true);
  };

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

  const bump = (delta: number): void => {
    const current = value === "" ? 0 : value;
    onChange(current + delta * factor);
  };

  return (
    <div className="relative w-full">
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        aria-required={required}
        aria-invalid={hasError === true ? true : undefined}
        value={focused ? editable : formatted}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => setDraft(e.target.value)}
        className={cn(
          inputClass,
          "pr-20",
          hasError === true && "border-destructive focus-visible:ring-destructive",
        )}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <button
          type="button"
          aria-label="−"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => bump(-1)}
          className={stepBtnClass}
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="+"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => bump(1)}
          className={stepBtnClass}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// Currency-Decimal-Stellen — überdeckt die wichtigsten Welt-Währungen.
// Default 2 wenn Code unbekannt.
export function currencyDecimals(code: string): number {
  if (code === "JPY" || code === "KRW" || code === "VND" || code === "ISK") return 0;
  if (code === "BHD" || code === "JOD" || code === "KWD" || code === "OMR" || code === "TND")
    return 3;
  return 2;
}

function guessLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}

// Locale-Decimal-Parse: erkennt automatisch ob Komma oder Punkt der
// Decimal-Separator ist. Intl.NumberFormat liefert die Trenner für
// das Locale, daraus bauen wir den Reverse-Parser.
function parseLocaleNumber(raw: string, locale: string): number {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const groupSep = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimalSep = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const cleaned = raw
    .split(groupSep)
    .join("")
    .split(decimalSep)
    .join(".")
    .replace(/[^0-9.-]/g, "");
  return Number(cleaned);
}
