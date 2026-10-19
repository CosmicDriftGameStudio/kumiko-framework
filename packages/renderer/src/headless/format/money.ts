// Currency decimal places — covers the world's zero- and three-decimal
// outliers, defaults to 2 for everything else. Shared between renderer-web's
// MoneyInput (minor-unit display factor) and RenderField's minor/major-unit
// conversion (kumiko-framework#1923) — a single source keeps both sides
// scaling the same currency the same way.
export function currencyDecimals(code: string): number {
  if (code === "JPY" || code === "KRW" || code === "VND" || code === "ISK") return 0;
  if (code === "BHD" || code === "JOD" || code === "KWD" || code === "OMR" || code === "TND")
    return 3;
  return 2;
}

const FALLBACK_MONEY_LOCALE = "en-US";

// An invalid tag makes Intl constructors throw a RangeError; canonicalizing up
// front keeps server renders and client cells safe. No navigator lookup, so it
// behaves the same on the server.
export function resolveSafeMoneyLocale(locale: string | undefined): string {
  try {
    return Intl.getCanonicalLocales(locale ?? FALLBACK_MONEY_LOCALE)[0] ?? FALLBACK_MONEY_LOCALE;
  } catch {
    return FALLBACK_MONEY_LOCALE;
  }
}

// currency is validated against the 3-letter-alpha shape Intl.NumberFormat
// requires: a non-conforming value (e.g. from a JSONB custom field) would throw
// a RangeError and take down the whole render instead of just this value.
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale?: string,
  fractionDigits?: number,
): string {
  if (!/^[A-Za-z]{3}$/.test(currency)) return String(amountMinor);
  const decimals = currencyDecimals(currency);
  const displayDigits = fractionDigits ?? decimals;
  return new Intl.NumberFormat(resolveSafeMoneyLocale(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: displayDigits,
    maximumFractionDigits: displayDigits,
  }).format(amountMinor / 10 ** decimals);
}
