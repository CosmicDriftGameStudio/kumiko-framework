// Client i18n bundle for the managed-pages admin screens. The browser renderer
// builds its fallback locale store ONLY from clientFeatures[].translations; the
// server-side r.translations bundle (feature.ts) never reaches it. To render the
// configEdit/entityEdit labels translated instead of raw, we mirror the same keys here.
//
// Single source: pivots MANAGED_PAGES_I18N (key-first { key: {de,en} }, server
// form) into the locale-first TranslationsByLocale form the client expects, so
// there is no key duplication and no drift.

import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { MANAGED_PAGES_I18N } from "./i18n.ts";

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(MANAGED_PAGES_I18N);
