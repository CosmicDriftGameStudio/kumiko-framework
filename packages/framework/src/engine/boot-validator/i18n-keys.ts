import {
  buildEffectiveTranslationKeys,
  featureHasI18nSurface,
  findTranslationLocaleGaps,
  requiredKeysFromFeature,
  requiredKeysFromNav,
  requiredKeysFromScreen,
  requiredKeysFromWorkspace,
} from "../../i18n/required-surface-keys";
import { buildConfigFeatureSchema, SETTINGS_HUB_FEATURE } from "../build-config-feature-schema";
import { createRegistry } from "../registry";
import type { FeatureDefinition } from "../types";
import type { Registry } from "../types/feature";

function requiredKeysFromGeneratedConfigHub(registry: Registry): readonly string[] {
  const schema = buildConfigFeatureSchema(registry);
  if (schema.navs.length === 0) return [];
  const out = new Set<string>();

  for (const screen of schema.screens) {
    for (const key of requiredKeysFromScreen(SETTINGS_HUB_FEATURE, screen)) out.add(key);
  }
  for (const nav of schema.navs) {
    for (const key of requiredKeysFromNav(nav)) out.add(key);
  }
  if (schema.workspace) {
    for (const key of requiredKeysFromWorkspace(schema.workspace.definition)) out.add(key);
  }
  out.add("config.settings.title");
  for (const scope of ["system", "tenant", "user"] as const) {
    out.add(`config.settings.${scope}`);
  }

  return [...out];
}

function isFrameworkOwnedI18nKey(key: string): boolean {
  return key.startsWith("kumiko.");
}

function hasDefinedTranslation(defined: Set<string>, key: string): boolean {
  if (defined.has(key)) return true;
  const colon = key.indexOf(":");
  if (colon > 0) {
    const feature = key.slice(0, colon);
    const local = key.slice(colon + 1);
    if (defined.has(`${feature}:${local}`)) return true;
  }
  if (key.includes(".")) {
    const feature = key.split(".")[0];
    if (feature && defined.has(`${feature}:${key}`)) return true;
  }
  return false;
}

export function validateI18nSurfaceKeys(features: readonly FeatureDefinition[]): void {
  const defined = buildEffectiveTranslationKeys(features);
  const registry = createRegistry(features);

  for (const feature of features) {
    if (!featureHasI18nSurface(feature)) continue;

    for (const key of requiredKeysFromFeature(feature)) {
      if (isFrameworkOwnedI18nKey(key)) continue;
      if (!hasDefinedTranslation(defined, key)) {
        throw new Error(
          `[i18n] Feature "${feature.name}": required translation key missing: "${key}"`,
        );
      }
    }
  }

  for (const key of requiredKeysFromGeneratedConfigHub(registry)) {
    if (!hasDefinedTranslation(defined, key)) {
      throw new Error(`[i18n] Settings-Hub: required translation key missing: "${key}"`);
    }
  }

  for (const gap of findTranslationLocaleGaps(features)) {
    throw new Error(
      `[i18n] Feature "${gap.featureName}": key "${gap.key}" missing locale(s): ${gap.missingLocales.join(", ")}`,
    );
  }
}
