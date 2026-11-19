// Client i18n bundle for the branding settings screen. The browser renderer
// builds its fallback locale store ONLY from clientFeatures[].translations; the
// server-side r.translations bundle (feature.ts) never reaches it, so the same
// keys are pivoted here (key-first server form → locale-first client form).

import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";
import { BRANDING_I18N } from "./i18n.ts";

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(BRANDING_I18N);
