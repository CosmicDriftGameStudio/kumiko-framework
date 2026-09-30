import type { Registry, TranslationKeys } from "../engine/types/index.js";
import { resolveTranslationValue } from "../ui-types/plural.js";

export {
  hasMailTranslations,
  mailT,
  registerMailTranslations,
  resolveMailLocale,
} from "./mail-registry.js";
export {
  canonicalizeLocaleTag,
  DEFAULT_LOCALE,
  isValidLocaleTag,
  pickAcceptLanguage,
  resolveHeaderLocale,
} from "./request-locale.js";
export { SETTINGS_HUB_I18N } from "./settings-hub-keys.js";

export type I18nOptions = {
  defaultLocale: string;
};

export type I18n = {
  t(key: string, locale?: string, params?: Readonly<Record<string, unknown>>): string;
  getAllKeys(): string[];
};

export function createI18n(registry: Registry, options: I18nOptions): I18n {
  const translations: TranslationKeys = registry.getAllTranslations();
  const { defaultLocale } = options;

  return {
    t(key: string, locale?: string, params?: Readonly<Record<string, unknown>>): string {
      const entry = translations[key];
      if (!entry) return key;

      const requestedLocale = locale ?? defaultLocale;
      // Plural category selection needs the locale the value actually came
      // from, not the requested one — falling back to defaultLocale must
      // apply defaultLocale's plural rules to that defaultLocale text.
      const hitLocale = entry[requestedLocale] !== undefined ? requestedLocale : defaultLocale;
      const value = entry[hitLocale];
      if (value === undefined) return key;
      return resolveTranslationValue(value, hitLocale, params);
    },

    getAllKeys(): string[] {
      return Object.keys(translations);
    },
  };
}
