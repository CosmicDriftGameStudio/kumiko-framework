// @runtime client
import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { AUDIT_I18N } from "../i18n";

export const defaultTranslations: TranslationsByLocale = translationsByLocaleFromKeys(AUDIT_I18N);
