import { canonicalLocaleOr } from "./number-format-cache.ts";

const FALLBACK_LOCALE = "en-US";

// An invalid tag makes every Intl constructor and toLocaleString throw a
// RangeError; without an ErrorBoundary that would take down the page on
// focus/blur. Canonicalizing once up front keeps all call sites safe.
export function resolveSafeLocale(locale: string | undefined): string {
  const candidate =
    locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined) ?? "";
  return canonicalLocaleOr(candidate, FALLBACK_LOCALE);
}
