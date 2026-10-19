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

// Separators come from Intl for the locale. A minus is only accepted at the
// very start: "1-23" is invalid rather than -123, so a typo never turns into
// a wrong amount. Anything besides digits and separators yields NaN so callers
// drop the input instead of storing a corrupted number.
export function parseLocaleNumber(raw: string, locale: string): number {
  const { groupSep, decimalSep } = localeSeparators(locale);
  const trimmed = raw.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [integerPart = "", fractionPart, ...extra] = body.split(decimalSep);
  if (extra.length > 0) return Number.NaN;
  if (!isValidIntegerPart(integerPart, fractionPart, groupSep)) return Number.NaN;
  if (fractionPart !== undefined && !/^\d*$/.test(fractionPart)) return Number.NaN;
  const digits = integerPart.replace(/\D/g, "");
  const n = Number(`${digits === "" ? "0" : digits}${fractionPart ? `.${fractionPart}` : ""}`);
  return negative ? -n : n;
}

function localeSeparators(locale: string): { groupSep: string; decimalSep: string } {
  const parts = new Intl.NumberFormat(resolveSafeLocale(locale)).formatToParts(1234.5);
  return {
    groupSep: parts.find((p) => p.type === "group")?.value ?? ",",
    decimalSep: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

// Group separators only count in valid positions: "1.5" in de is rejected
// instead of silently becoming 15. An empty integer part (",5") stays valid
// when a fraction follows.
function isValidIntegerPart(
  integerPart: string,
  fractionPart: string | undefined,
  groupSep: string,
): boolean {
  if (integerPart === "") return fractionPart !== undefined && fractionPart !== "";
  const groupClass = /\s/.test(groupSep) ? "[\\s\\u00a0\\u202f]" : escapeRegExp(groupSep);
  return new RegExp(`^(?:\\d+|\\d{1,3}(?:${groupClass}\\d{3})+)$`).test(integerPart);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
