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
