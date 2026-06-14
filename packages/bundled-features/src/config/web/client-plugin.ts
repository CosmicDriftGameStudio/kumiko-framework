// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import { CONFIG_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";

export type ConfigClientOptions = {
  /** Key-wise overrides over the default bundles (de/en). */
  readonly translations?: TranslationsByLocale;
};

export type ConfigClientFeature = {
  readonly name: typeof CONFIG_FEATURE;
  readonly translations: TranslationsByLocale;
};

// Ships the generic Settings-Hub labels (config.settings.*). Mount it in
// clientFeatures next to the app's own feature client — without it the
// audience groups render their raw i18n keys.
export function configClient(options?: ConfigClientOptions): ConfigClientFeature {
  return {
    name: CONFIG_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
  };
}
