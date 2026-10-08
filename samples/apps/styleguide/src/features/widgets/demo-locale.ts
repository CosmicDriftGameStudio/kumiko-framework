// Server-side locale helpers for the dashboard demo queries. Not shared with
// renderer-web's format.ts: server code must not import renderer-web.

import { WIDGETS_I18N } from "./i18n";

type WidgetsI18nKey = keyof typeof WIDGETS_I18N;
type DemoCurrency = "EUR" | "USD";

const FALLBACK_LOCALE = "en";

// Intl throws RangeError on malformed tags.
function usableLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

// The bundle only carries de + en: any "de" tag ("de-AT") picks de, everything else en.
export function demoText(key: WidgetsI18nKey, locale: string): string {
  const entry = WIDGETS_I18N[key];
  const primarySubtag = usableLocale(locale).split("-")[0];
  return primarySubtag === "de" ? entry.de : entry.en;
}

export function demoMoney(amount: number, currency: DemoCurrency, locale: string): string {
  return new Intl.NumberFormat(usableLocale(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function demoPercent(fraction: number, locale: string): string {
  return new Intl.NumberFormat(usableLocale(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(fraction);
}

export function demoMonthYear(year: number, month: number, locale: string): string {
  return Temporal.PlainDate.from({ year, month, day: 1 }).toLocaleString(usableLocale(locale), {
    month: "short",
    year: "numeric",
  });
}
