import { formatMoney } from "@cosmicdrift/kumiko-renderer-web";

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

// Static catalog demo values — reuses formatMoney (money-input.tsx) instead
// of hand-rolling a second currency formatter, so symbol placement (prefix
// in en, suffix in de) follows Intl's own locale data instead of a bespoke
// template string. `n` is EUR in major units (catalog demo values like
// 92753 read as €92,753), formatMoney wants minor units (cents).
export function euro(n: number, locale: string): string {
  return formatMoney(Math.round(n * 100), "EUR", safeLocale(locale));
}

export function percent(n: number, locale: string): string {
  return new Intl.NumberFormat(safeLocale(locale), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n / 100);
}
