import { createFallbackLogger } from "../../logging/utils.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { API_EXT_RULES } from "./api-ext-rules.ts";
import { collectBootRuleViolations } from "./boot-report.ts";
import { bootRuleError } from "./boot-rule.ts";

const log = createFallbackLogger("kumiko:boot");

// --- Cross-feature API exposure / usage matching ---
//
// `r.exposesApi(name, impl)` registers a callable; `r.usesApi(name)`
// declares a caller. Boot validation checks three invariants:
//   1. Every usesApi(name) finds an exposesApi(name) in some feature.
//   2. The exposing feature is listed in the caller's
//      requires/optionalRequires so cross-feature call ordering works.
//   3. Self-exposure is allowed (a feature calling its own API), but is
//      warned about because it is typically a refactoring leftover.
//
// apiNames must be globally unique across features; validateBoot() checks
// this before the per-feature walk.
export function validateApiExposureMatching(
  feature: FeatureDefinition,
  allExposedApis: ReadonlyMap<string, string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  collectBootRuleViolations(feature.usedApis, (apiName) => {
    const providerFeature = allExposedApis.get(apiName);
    if (!providerFeature) {
      const known = [...allExposedApis.keys()].sort().join(", ") || "(none)";
      throw bootRuleError(API_EXT_RULES.unknownApi, {
        message: `[Feature ${feature.name}] r.usesApi("${apiName}") but no feature exposes that API. Known exposed APIs: ${known}`,
      });
    }

    if (providerFeature === feature.name) {
      log.warn(
        `[Feature ${feature.name}] r.usesApi("${apiName}") on its own r.exposesApi — typically a refactor leftover. Call the impl directly instead.`,
      );
      return;
    }

    const allDeps = [...feature.requires, ...feature.optionalRequires];
    if (!allDeps.includes(providerFeature)) {
      throw bootRuleError(API_EXT_RULES.providerNotRequired, {
        message: `[Feature ${feature.name}] r.usesApi("${apiName}") is exposed by "${providerFeature}" but feature is not in requires/optionalRequires. Add r.requires({ features: ["${providerFeature}"] }).`,
      });
    }

    // Sanity: the provider feature must exist in this app's feature set.
    // This should always hold when allExposedApis was built from `features`,
    // but remains defensive for unclear constructor paths.
    if (!featureMap.has(providerFeature)) {
      throw bootRuleError(API_EXT_RULES.providerNotMounted, {
        message: `[Feature ${feature.name}] internal: r.usesApi("${apiName}") points to provider "${providerFeature}" which is not in feature map. Register the provider feature in the app's feature list.`,
      });
    }
  });
}

// --- Extension usage validation ---

export function validateExtensionUsages(
  feature: FeatureDefinition,
  extensionProviders: ReadonlyMap<string, string>,
): void {
  collectBootRuleViolations(feature.extensionUsages, (usage) => {
    const providerFeature = extensionProviders.get(usage.extensionName);
    if (!providerFeature) {
      throw bootRuleError(API_EXT_RULES.unknownExtension, {
        message: `Feature "${feature.name}" uses extension "${usage.extensionName}" on entity "${usage.entityName}" but no feature defines that extension. Register the feature that defines it or fix the extension name.`,
      });
    }

    if (providerFeature === feature.name) {
      // skip: self-extension is legitimate, requires(self) would be circular
      return;
    }
    const allDeps = [...feature.requires, ...feature.optionalRequires];
    if (!allDeps.includes(providerFeature)) {
      throw bootRuleError(API_EXT_RULES.extensionProviderNotRequired, {
        message: `Feature "${feature.name}" uses extension "${usage.extensionName}" but missing requires("${providerFeature}"). Add r.requires({ features: ["${providerFeature}"] }).`,
      });
    }
  });
}
