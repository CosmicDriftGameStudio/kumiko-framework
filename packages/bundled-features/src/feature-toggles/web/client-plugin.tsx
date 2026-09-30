// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { FEATURE_TOGGLES_FEATURE } from "../constants.js";
import { defaultTranslations } from "./i18n.js";

export type FeatureTogglesClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function featureTogglesClient(
  options?: FeatureTogglesClientOptions,
): ClientFeatureDefinition {
  return {
    name: FEATURE_TOGGLES_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
