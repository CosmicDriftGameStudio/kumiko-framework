import { currencyDecimals } from "@cosmicdrift/kumiko-types/minor-units";
import { cachedNumberFormat, canonicalLocaleOr } from "./number-format-cache.ts";

export { currencyDecimals };

export type FormatMoneyOptions = {
  readonly locale?: string;
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly signDisplay?: "auto" | "negative" | "always" | "exceptZero" | "never";
  readonly notation?: "standard" | "compact";
};

export function formatMoneyValue(
  value: { readonly amount: number; readonly currency: string },
  options?: FormatMoneyOptions,
): string {
  return formatMoney(value.amount, value.currency, options);
}

const FALLBACK_MONEY_LOCALE = "en-US";

// An invalid tag makes Intl constructors throw a RangeError; canonicalizing up
// front keeps server renders and client cells safe. No navigator lookup, so it
// behaves the same on the server.
export function resolveSafeMoneyLocale(locale: string | undefined): string {
  return canonicalLocaleOr(locale ?? FALLBACK_MONEY_LOCALE, FALLBACK_MONEY_LOCALE);
}

export function isCurrencyCode(code: string): boolean {
  return /^[A-Za-z]{3}$/.test(code);
}

// currency is validated against the 3-letter-alpha shape Intl.NumberFormat
// requires: a non-conforming value (e.g. from a JSONB custom field) would throw
// a RangeError and take down the whole render instead of just this value. Such a
// value is shown as a plain two-decimal number without a symbol.
export function formatMoney(
  amountMinor: number,
  currency: string,
  options: FormatMoneyOptions = {},
): string {
  const validCurrency = isCurrencyCode(currency);
  const decimals = validCurrency ? currencyDecimals(currency) : 2;
  const max =
    options.maximumFractionDigits ?? Math.max(decimals, options.minimumFractionDigits ?? decimals);
  const min = options.minimumFractionDigits ?? Math.min(decimals, max);
  return cachedNumberFormat(resolveSafeMoneyLocale(options.locale), {
    ...(validCurrency && { style: "currency", currency }),
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    ...(options.signDisplay && { signDisplay: options.signDisplay }),
    ...(options.notation && { notation: options.notation }),
  }).format(amountMinor / 10 ** decimals);
}
