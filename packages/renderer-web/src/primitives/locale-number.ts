// Shared locale handling for the text-based numeric inputs (MoneyInput,
// NumberInput).

const FALLBACK_LOCALE = "en-US";

// An invalid tag makes every Intl constructor and toLocaleString throw a
// RangeError; without an ErrorBoundary that would take down the page on
// focus/blur. Canonicalizing once up front keeps all call sites safe.
export function resolveSafeLocale(locale: string | undefined): string {
  const candidate =
    locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined) ?? "";
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

// Locale-Decimal-Parse: erkennt automatisch ob Komma oder Punkt der
// Decimal-Separator ist. Intl.NumberFormat liefert die Trenner für
// das Locale, daraus bauen wir den Reverse-Parser. Strict beim
// Vorzeichen: ein `-` darf NUR ganz vorne stehen — `1-23` ist invalid,
// nicht `-123` (sonst würden vertippte Inputs zu falschen Beträgen).
export function parseLocaleNumber(raw: string, locale: string): number {
  const parts = new Intl.NumberFormat(resolveSafeLocale(locale)).formatToParts(1234.5);
  const groupSep = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimalSep = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  // Body darf nur noch Ziffern, Group- und Decimal-Separator enthalten.
  // Alles andere (zweites Minus, Buchstaben, etc.) → NaN, damit Caller
  // (handleBlur) den Wert verwirft statt eine korrupte Zahl zu setzen.
  const [integerPart = "", fractionPart, ...extra] = body.split(decimalSep);
  if (extra.length > 0) return Number.NaN;
  // Group separators only count in valid positions: "1.5" in de is not 1500
  // silently, it is rejected so the draft stays visible.
  const groupClass = /\s/.test(groupSep) ? "[\\s\\u00a0\\u202f]" : escapeRegExp(groupSep);
  const validInteger = new RegExp(`^(?:\\d+|\\d{1,3}(?:${groupClass}\\d{3})+)$`);
  if (!validInteger.test(integerPart)) {
    // ".5" / ",5" style (empty integer part) stays valid.
    if (!(integerPart === "" && fractionPart !== undefined && fractionPart !== "")) {
      return Number.NaN;
    }
  }
  if (fractionPart !== undefined && !/^\d*$/.test(fractionPart)) return Number.NaN;
  const digits = integerPart.replace(/\D/g, "");
  const n = Number(`${digits === "" ? "0" : digits}${fractionPart ? `.${fractionPart}` : ""}`);
  return negative ? -n : n;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
