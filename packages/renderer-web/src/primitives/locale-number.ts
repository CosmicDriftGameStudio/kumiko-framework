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
  const cleaned = body.split(groupSep).join("").split(decimalSep).join(".");
  if (!/^[0-9]*\.?[0-9]*$/.test(cleaned) || cleaned === "" || cleaned === ".") return Number.NaN;
  const n = Number(cleaned);
  return negative ? -n : n;
}
