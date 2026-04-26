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
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  // Numerische Inputs rechtsbündig — wie native type=number — damit
  // Beträge unter Listen-Spalten an den Tausender-Stellen alignen.
  "text-right tabular-nums";

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

  // Edit-Mode: Decimal-String ohne Tausender-Trenner. Konsistente Helper-
  // Funktion damit Focus-Init und Render-Fallback nicht auseinanderdriften.
  const toEditable = (m: number | null): string =>
    m === null
      ? ""
      : m.toLocaleString(resolvedLocale, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: false,
        });

  const editable = focused ? draft : toEditable(major);

  const handleFocus = (_e: FocusEvent<HTMLInputElement>): void => {
    setDraft(toEditable(major));
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
