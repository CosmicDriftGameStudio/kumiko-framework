// @runtime client
// Client-feature factory for tier-engine. Supplies the default translations
// for the declarative tier-admin actionForm (registered server-side via
// r.screen in the feature); the app places the screen only via r.nav.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { TIER_ENGINE_FEATURE } from "../constants";
import { defaultTranslations } from "../i18n";

export type TierEngineClientOptions = {
  /** Per-key overrides over the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function tierEngineClient(options?: TierEngineClientOptions): ClientFeatureDefinition {
  return {
    name: TIER_ENGINE_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
