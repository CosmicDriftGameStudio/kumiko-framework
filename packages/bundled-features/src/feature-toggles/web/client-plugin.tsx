// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { FEATURE_TOGGLES_FEATURE, TOGGLE_ADMIN_SCREEN_ID } from "../constants";
import { defaultTranslations } from "./i18n";
import { ToggleAdminScreen } from "./toggle-admin-screen";

export type FeatureTogglesClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function featureTogglesClient(
  options?: FeatureTogglesClientOptions,
): ClientFeatureDefinition {
  return {
    name: FEATURE_TOGGLES_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [TOGGLE_ADMIN_SCREEN_ID]: ToggleAdminScreen,
    },
  };
}
