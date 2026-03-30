import type { Registry, TranslationKeys } from "../engine/types";

export type I18nOptions = {
  defaultLocale: string;
};

export type I18n = {
  t(key: string, locale?: string): string;
  getAllKeys(): string[];
};

export function createI18n(registry: Registry, options: I18nOptions): I18n {
  const translations: TranslationKeys = registry.getAllTranslations();
  const { defaultLocale } = options;

  return {
    t(key: string, locale?: string): string {
      const entry = translations[key];
      if (!entry) return key;

      const resolvedLocale = locale ?? defaultLocale;
      return entry[resolvedLocale] ?? entry[defaultLocale] ?? key;
    },

    getAllKeys(): string[] {
      return Object.keys(translations);
    },
  };
}
