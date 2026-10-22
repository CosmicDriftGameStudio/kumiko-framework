import {
  buildEffectiveTranslationKeys,
  featureHasI18nSurface,
  findRequiredLocaleGaps,
  findTranslationLocaleGaps,
  requiredKeysFromFeature,
  requiredKeysFromNav,
  requiredKeysFromScreen,
  requiredKeysFromWorkspace,
  screenTitleKey,
} from "../../i18n/required-surface-keys.ts";
import {
  buildConfigFeatureSchema,
  type ConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
} from "../build-config-feature-schema.ts";
import { EXTENSION_SELECTOR_HINT_KEY } from "../extension-selector-plugins.ts";
import { createRegistry } from "../registry.ts";
import type { FeatureDefinition, ScreenDefinition } from "../types/index.ts";

function isDormantSecretsScreen(screen: ScreenDefinition): boolean {
  return screen.type === "secretsEdit" && screen.dormant === true;
}

function requiredKeysFromGeneratedConfigHub(schema: ConfigFeatureSchema): readonly string[] {
  if (schema.navs.length === 0) return [];
  const out = new Set<string>();

  // The generator's section titles + mask-title field-label overrides are
  // dot-form i18n references (`${feature}.settings`), never literal display
  // text, so treatDotFormAsKey bypasses isI18nKey's colon-only check.
  for (const screen of schema.screens) {
    for (const key of requiredKeysFromScreen(SETTINGS_HUB_FEATURE, screen, {
      treatDotFormAsKey: true,
    })) {
      // Embedded selector-plugin secrets panels render no title of their own.
      if (isDormantSecretsScreen(screen) && key === screenTitleKey(screen.id)) continue;
      out.add(key);
    }
  }
  if (schema.screens.some((s) => s.type === "dashboard")) out.add(EXTENSION_SELECTOR_HINT_KEY);
  for (const nav of schema.navs) {
    for (const key of requiredKeysFromNav(nav, { treatDotFormAsKey: true })) out.add(key);
  }
  if (schema.workspace) {
    for (const key of requiredKeysFromWorkspace(schema.workspace.definition)) out.add(key);
  }
  out.add("config.settings.title");
  if (schema.screens.some((s) => s.type === "secretsEdit")) out.add("config.secrets.title");
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
  const generatedConfigHub = buildConfigFeatureSchema(registry);
  // The secrets screen's labels/hints come from the `r.secret()` declaration
  // itself, not from r.translations — without this, every app with a
  // declared secret would fail boot on its own generated keys.
  for (const key of Object.keys(generatedConfigHub.translations ?? {})) defined.add(key);

  for (const feature of features) {
    if (!featureHasI18nSurface(feature)) continue;

    for (const key of requiredKeysFromFeature(feature)) {
      if (isFrameworkOwnedI18nKey(key)) continue;
      if (!hasDefinedTranslation(defined, key)) {
        throw new Error(
          `[i18n] Feature "${feature.name}": required translation key missing: "${key}". Add it via r.translations(...) in this feature.`,
        );
      }
    }
  }

  for (const key of requiredKeysFromGeneratedConfigHub(generatedConfigHub)) {
    if (!hasDefinedTranslation(defined, key)) {
      throw new Error(
        `[i18n] Settings-Hub: required translation key missing: "${key}". Add it via r.translations(...) in the owning feature.`,
      );
    }
  }
}

export function validateTranslationLocaleConsistency(features: readonly FeatureDefinition[]): void {
  const gaps = findTranslationLocaleGaps(features);
  if (gaps.length > 0) {
    const lines = gaps.map(
      (gap) =>
        `[i18n] Feature "${gap.featureName}": translation key "${gap.key}" is missing locale(s) ${gap.missingLocales.join(", ")}.`,
    );
    throw new Error(
      `${lines.join("\n")}\nEvery locale a feature uses must be maintained for every one of its translation keys; otherwise move that locale into a locale package.`,
    );
  }
}

export function validateRequiredLocales(
  features: readonly FeatureDefinition[],
  requiredLocales: readonly string[] | undefined,
): void {
  const gaps = findRequiredLocaleGaps(features, requiredLocales ?? []);
  if (gaps.length > 0) {
    const lines = gaps.map(
      (gap) =>
        `[i18n] Feature "${gap.featureName}": translation key "${gap.key}" is missing required locale(s) ${gap.missingLocales.join(", ")}.`,
    );
    throw new Error(
      `${lines.join("\n")}\nThe app requires locales [${(requiredLocales ?? []).join(", ")}] for every translation key; load the matching locale package or add the missing translations.`,
    );
  }
}
