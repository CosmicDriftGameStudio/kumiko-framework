// @runtime client
import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { JOBS_I18N } from "../i18n";

export const defaultTranslations: TranslationsByLocale = translationsByLocaleFromKeys(JOBS_I18N);
