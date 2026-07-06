// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import { JOBS_I18N } from "../i18n";

const LOCALES = ["de", "en"] as const;

export const defaultTranslations: TranslationsByLocale = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    Object.fromEntries(
      Object.entries(JOBS_I18N).map(([key, value]) => [key, value[locale]]),
    ),
  ]),
);
