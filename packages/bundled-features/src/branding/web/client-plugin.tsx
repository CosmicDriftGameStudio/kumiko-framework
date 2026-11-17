// Client feature factory for branding: translations of the settings screen. Apps mount it in
// createKumikoApp({ clientFeatures: [brandingClient()] }) so the admin labels render translated.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { BRANDING_FEATURE } from "../constants.ts";
import { defaultTranslations } from "./default-translations.ts";

export type BrandingClientOptions = {
  /** Key-wise overrides of the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function brandingClient(options?: BrandingClientOptions): ClientFeatureDefinition {
  return {
    name: BRANDING_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
