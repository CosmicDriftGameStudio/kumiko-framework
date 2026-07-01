// @runtime client
// Client-feature factory for personal-access-tokens. Ships the PatTokensScreen
// (mapped to the "api-tokens" screen id) + default translations. Apps mount it
// in createKumikoApp({ clientFeatures: [personalAccessTokensClient()] }); the
// server registers the screen dormant (r.screen) and the app places it via
// r.nav.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { PAT_FEATURE, PAT_SCREEN_ID } from "../constants";
import { defaultTranslations } from "./i18n";
import { PatTokensScreen } from "./pat-tokens-screen";

export type PersonalAccessTokensClientOptions = {
  /** Key-wise overrides over the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function personalAccessTokensClient(
  options?: PersonalAccessTokensClientOptions,
): ClientFeatureDefinition {
  return {
    name: PAT_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [PAT_SCREEN_ID]: PatTokensScreen,
    },
  };
}
