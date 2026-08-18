// @runtime client
// Client pivot of ADMIN_SHELL_I18N — same keys as server r.translations bundle.

import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { ADMIN_SHELL_I18N } from "../i18n";

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(ADMIN_SHELL_I18N);
