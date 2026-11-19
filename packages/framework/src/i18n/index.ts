import type { TranslationKeys } from "@cosmicdrift/kumiko-types/config";
import type { Registry } from "../engine/types/index.ts";

import { resolveTranslationValue } from "../ui-types/plural.ts";
import type { I18n, I18nOptions } from "./internals.ts";

export {
  hasMailTranslationKey,
  hasMailTranslations,
  listMailLocales,
  mailT,
  registerMailTranslations,
  resolveMailLocale,
} from "./mail-registry.ts";
export {
  canonicalizeLocaleTag,
  isValidLocaleTag,
  rankPreferredLocales,
} from "./request-locale.ts";
export { SETTINGS_HUB_I18N } from "./settings-hub-keys.ts";

export function createI18n(registry: Registry, options: I18nOptions): I18n {
  const translations: TranslationKeys = registry.getAllTranslations();
  const { defaultLocale } = options;

  return {
    t(key: string, locale?: string, params?: Readonly<Record<string, unknown>>): string {
      const entry = translations[key];
      if (!entry) return key;

      const requestedLocale = locale ?? defaultLocale;
      // Request locales arrive canonical ("en-US"); an "en" text must win over the default locale. Plural rules follow the locale the value came from.
      const baseLanguage = requestedLocale.split("-")[0] ?? requestedLocale;
      for (const candidate of [requestedLocale, baseLanguage, defaultLocale]) {
        const value = entry[candidate];
        if (value !== undefined) return resolveTranslationValue(value, candidate, params);
      }
      return key;
    },

    getAllKeys(): string[] {
      return Object.keys(translations);
    },
  };
}
