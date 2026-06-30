import {
  buildEffectiveTranslationKeys,
  findTranslationLocaleGaps,
  requiredKeysFromFeature,
} from "../../i18n/required-surface-keys";
import type { FeatureDefinition } from "../types";

export function validateI18nSurfaceKeys(features: readonly FeatureDefinition[]): void {
  const defined = buildEffectiveTranslationKeys(features);

  for (const feature of features) {
    // ponytail: features without r.translations are legacy — once they register
    // keys, surface + locale checks apply (apps, new bundled work).
    if (Object.keys(feature.translations ?? {}).length === 0) continue;

    for (const key of requiredKeysFromFeature(feature)) {
      if (!defined.has(key)) {
        throw new Error(
          `[i18n] Feature "${feature.name}": required translation key missing: "${key}"`,
        );
      }
    }
  }

  for (const gap of findTranslationLocaleGaps(features)) {
    throw new Error(
      `[i18n] Feature "${gap.featureName}": key "${gap.key}" missing locale(s): ${gap.missingLocales.join(", ")}`,
    );
  }
}

