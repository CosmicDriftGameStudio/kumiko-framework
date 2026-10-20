import { DEFAULT_TEMPLATE_LOCALES } from "./constants.ts";

// The editor opens in the language the user works in when the template has it
// (or, for a template without any version yet, when the app offers it).
export function defaultLocaleOf(
  uiLocale: string,
  appLocales: readonly string[],
  rowLocales: readonly string[],
): string {
  const available = rowLocales.length > 0 ? rowLocales : appLocales;
  const uiLanguage = uiLocale.split("-")[0] ?? uiLocale;
  const fromUi = [uiLocale, uiLanguage].find((candidate) => available.includes(candidate));
  if (fromUi !== undefined) return fromUi;
  const preferred = appLocales[0] ?? DEFAULT_TEMPLATE_LOCALES[0] ?? "de";
  if (rowLocales.length === 0 || rowLocales.includes(preferred)) return preferred;
  return rowLocales[0] ?? preferred;
}
