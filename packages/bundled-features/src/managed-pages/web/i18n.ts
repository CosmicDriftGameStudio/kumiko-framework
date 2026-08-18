// @runtime client
// Client-i18n-Bundle für die managed-pages Admin-Screens. Der Browser-Renderer
// baut seinen Fallback-Locale-Store NUR aus clientFeatures[].translations — der
// server-seitige r.translations-Bundle (feature.ts) erreicht ihn nie. Damit die
// configEdit/entityEdit-Labels im Client übersetzt rendern statt roh, spiegeln
// wir hier dieselben Keys.
//
// Single source: pivotiert MANAGED_PAGES_I18N (key-first { key: {de,en} },
// Server-Form) in die locale-first TranslationsByLocale-Form die der Client
// erwartet — kein Key-Duplikat, kein Drift.

import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { MANAGED_PAGES_I18N } from "../i18n";

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(MANAGED_PAGES_I18N);
