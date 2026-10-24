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
