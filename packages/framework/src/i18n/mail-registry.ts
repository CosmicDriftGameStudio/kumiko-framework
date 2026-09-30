import { resolveTranslationValue, type TranslationValue } from "../ui-types/plural.js";

const tables = new Map<string, Readonly<Record<string, TranslationValue>>>();

export function registerMailTranslations(
  locale: string,
  bundle: Readonly<Record<string, TranslationValue>>,
): void {
  const prev = tables.get(locale) ?? {};
  tables.set(locale, { ...prev, ...bundle });
}

export function hasMailTranslations(locale: string): boolean {
  const root = locale.split("-")[0] ?? locale;
  return tables.has(locale) || tables.has(root);
}

export function mailT(
  locale: string,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const root = locale.split("-")[0] ?? locale;
  // Plural category selection needs the locale the value actually came
  // from, not the requested one — a `pl` bundle falling back to `en`
  // must apply English plural rules to that `en` text.
  for (const localeToTry of [locale, root, "en"]) {
    const value = tables.get(localeToTry)?.[key];
    if (value !== undefined) return resolveTranslationValue(value, localeToTry, params);
  }
  return key;
}

/** Locale key mailT would actually use (exact → root → en). Use for appUrl
 *  path negotiation so the link language matches the rendered mail body. */
export function resolveMailLocale(locale: string): string {
  const root = locale.split("-")[0] ?? locale;
  if (tables.has(locale)) return locale;
  if (tables.has(root)) return root;
  if (tables.has("en")) return "en";
  return "en";
}
