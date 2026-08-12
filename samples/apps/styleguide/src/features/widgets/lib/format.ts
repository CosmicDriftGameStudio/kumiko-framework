// `locale` comes from useLocale(), whose default resolver reads it
// unvalidated from localStorage/navigator.language — a structurally invalid
// tag (e.g. "de_DE") throws a RangeError out of toLocaleString with no
// ErrorBoundary in this render tree. Same failure mode formatMoney guards
// against (money-input.tsx); fall back to "en" instead of crashing the page.
function safeLocale(locale: string): string {
  try {
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch {
    return "en";
  }
}

// Static catalog demo values — separators follow the active locale, unlike
// MoneyField/PercentField which bring their own formatters.
export function euro(n: number, locale: string): string {
  return `${n.toLocaleString(safeLocale(locale))} €`;
}

export function percent(n: number, locale: string): string {
  const resolved = safeLocale(locale);
  const formatted = n.toLocaleString(resolved, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return resolved.startsWith("de") ? `${formatted} %` : `${formatted}%`;
}
