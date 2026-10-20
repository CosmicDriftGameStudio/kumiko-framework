import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { SESSIONS_I18N } from "./i18n.ts";

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(SESSIONS_I18N);
