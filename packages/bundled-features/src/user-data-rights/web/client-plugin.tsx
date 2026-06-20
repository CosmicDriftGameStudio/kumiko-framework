// @runtime client
// Client-Feature-Factory für user-data-rights. Liefert den
// PrivacyCenterScreen (gemappt auf die Screen-id "privacy-center") +
// Default-Translations. Apps hängen es in
// createKumikoApp({ clientFeatures: [userDataRightsClient()] }) ein; der
// Screen wird server-seitig vom Feature dormant als custom-Screen
// registriert (r.screen), die App platziert ihn via r.nav.

import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { PRIVACY_CENTER_SCREEN_ID, USER_DATA_RIGHTS_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";
import { PrivacyCenterScreen } from "./privacy-center-screen";

export type UserDataRightsClientOptions = {
  /** Key-weise Overrides über die Default-Bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export function userDataRightsClient(
  options?: UserDataRightsClientOptions,
): ClientFeatureDefinition {
  return {
    name: USER_DATA_RIGHTS_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [PRIVACY_CENTER_SCREEN_ID]: PrivacyCenterScreen,
    },
  };
}
