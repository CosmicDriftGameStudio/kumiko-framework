import type { FeatureDefinition } from "../types";

// --- Cross-feature API exposure / usage matching ---
//
// `r.exposesApi(name, impl)` registers a callable; `r.usesApi(name)`
// declares a caller. Boot-Validator prüft drei Invarianten:
//   1. Jeder usesApi(name) findet einen exposesApi(name) in irgendeinem
//      Feature.
//   2. Das exposing-Feature ist in requires/optionalRequires des callers
//      gelisted (sonst klappt die Cross-Feature-Aufruf-Reihenfolge nicht).
//   3. Self-exposure ist erlaubt (Feature ruft eigene API), wird aber
//      mit Warning markiert weil es typisch ein Refactor-Restbestand ist.
//
// Globale Eindeutigkeit der apiNames (kein Dublicate über Features)
// wird in validateBoot() vor dem Per-Feature-Walk geprüft.
export function validateApiExposureMatching(
  feature: FeatureDefinition,
  allExposedApis: ReadonlyMap<string, string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const apiName of feature.usedApis) {
    const providerFeature = allExposedApis.get(apiName);
    if (!providerFeature) {
      const known = [...allExposedApis.keys()].sort().join(", ") || "(none)";
      throw new Error(
        `[Feature ${feature.name}] r.usesApi("${apiName}") but no feature exposes that API. Known exposed APIs: ${known}`,
      );
    }

    if (providerFeature === feature.name) {
      // biome-ignore lint/suspicious/noConsole: boot-time dev hint, no logger available yet
      console.warn(
        `[kumiko:boot] [Feature ${feature.name}] r.usesApi("${apiName}") on its own r.exposesApi — typically a refactor leftover. Call the impl directly instead.`,
      );
      continue;
    }

    const allDeps = [...feature.requires, ...feature.optionalRequires];
    if (!allDeps.includes(providerFeature)) {
      throw new Error(
        `[Feature ${feature.name}] r.usesApi("${apiName}") is exposed by "${providerFeature}" but feature is not in requires/optionalRequires. Add r.requires("${providerFeature}").`,
      );
    }

    // Sanity: provider feature actually exists in this app's feature set.
    // Should always be true if allExposedApis was built from `features`,
    // aber defensiv für unklare Constructor-Pfade.
    if (!featureMap.has(providerFeature)) {
      throw new Error(
        `[Feature ${feature.name}] internal: r.usesApi("${apiName}") points to provider "${providerFeature}" which is not in feature map`,
      );
    }
  }
}

// --- Extension usage validation ---

export function validateExtensionUsages(
  feature: FeatureDefinition,
  extensionProviders: ReadonlyMap<string, string>,
): void {
  for (const usage of feature.extensionUsages) {
    const providerFeature = extensionProviders.get(usage.extensionName);
    if (!providerFeature) {
      throw new Error(
        `Feature "${feature.name}" uses extension "${usage.extensionName}" on entity "${usage.entityName}" but no feature defines that extension`,
      );
    }

    const allDeps = [...feature.requires, ...feature.optionalRequires];
    if (!allDeps.includes(providerFeature)) {
      throw new Error(
        `Feature "${feature.name}" uses extension "${usage.extensionName}" but missing requires("${providerFeature}")`,
      );
    }
  }
}
