import { QnTypes, qualifyEntityName } from "../qualified-name";
import type { ClaimKeyDefinition, FeatureDefinition } from "../types";
import { validateApiExposureMatching, validateExtensionUsages } from "./api-ext";
import {
  validateCircularDeps,
  validateConfigKeyAllowPerRequest,
  validateConfigKeyBacking,
  validateConfigKeyBounds,
  validateConfigKeyComputed,
  validateConfigKeyRequired,
  validateConfigReads,
  warnOnToggleableDependencies,
} from "./config-deps";
import {
  validateDerivedFieldCollisions,
  validateEmbeddedFields,
  validateEncryptedFields,
  validateEntityIndexes,
  validateExtendSchemaCollisions,
  validateExtensionPreSaveWiring,
  validateFileFields,
  validateHandlerAccess,
  validateLocatedTimestamps,
  validateMultiSelectFields,
  validateMultiStreamProjections,
  validateReferenceFields,
  validateTransitions,
} from "./entity-handler";
import { validateGdprHookCompleteness, validateGdprStoragePersistence } from "./gdpr-storage";
import { validateI18nSurfaceKeys } from "./i18n-keys";
import { validateOwnershipRules } from "./ownership";
import { validatePiiAndRetention } from "./pii-retention";
import {
  collectKnownRoles,
  collectNavQns,
  collectScreenQns,
  collectScreensByShortId,
  collectWorkspaceQns,
  collectWriteHandlerQns,
  validateDefaultWorkspaceUniqueness,
  validateNavCycles,
  validateNavs,
  validateScreenShortIdCollisions,
  validateScreens,
  validateWorkspaces,
} from "./screens-nav";

export { validateAppCustomScreenWriteQns } from "./custom-screen-write-qns";
// Re-export: wird von run-dev-app.ts benötigt um Write-Handler-QNs
// an den Codegen zu übergeben. Nicht Teil von validateBoot, aber
// dieselbe Extraktionslogik.
export { collectWriteHandlerQns } from "./screens-nav";

/**
 * Validates all feature configurations at boot time.
 * Throws on the first error found — fail fast.
 */
export function validateBoot(features: readonly FeatureDefinition[]): void {
  const featureMap = new Map<string, FeatureDefinition>();
  for (const f of features) {
    featureMap.set(f.name, f);
  }

  // Collect all extension names and their schema extensions
  const extensionProviders = new Map<string, string>();
  for (const f of features) {
    for (const extName of Object.keys(f.registrarExtensions)) {
      extensionProviders.set(extName, f.name);
    }
  }

  // Collect all config keys across features (for cross-feature reference validation)
  const allConfigKeys = new Set<string>();
  // Qualified config-key set für ConfigEditScreen-Validation. MUSS via
  // qualifyEntityName kanonisiert werden (toKebab auf Feature + Key) — exakt
  // wie define-feature/registry den QN bildet. Der rohe f.configKeys-Key ist
  // der camelCase-Objekt-Key (`brandingTitle`), die echte QN aber
  // `…:config:branding-title`; ohne toKebab failt jeder configEdit-Screen mit
  // multi-word Config-Key fälschlich. allConfigKeys oben nutzt das ältere
  // `feature.short`-Format für validateConfigReads.
  const allConfigKeyQns = new Set<string>();
  for (const f of features) {
    for (const key of Object.keys(f.configKeys)) {
      allConfigKeys.add(`${f.name}.${key}`);
      allConfigKeyQns.add(qualifyEntityName(f.name, QnTypes.config, key));
    }
  }

  // Collect all claim keys — the ownership-rule validator below resolves
  // `from("claim:<feature>:<key>")` strings against this map. Qualified name
  // is how the resolver / readClaim / ownership system all reference claims,
  // so we key on the qualifiedName here too.
  const allClaimKeys = new Map<string, ClaimKeyDefinition>();
  for (const f of features) {
    for (const def of Object.values(f.claimKeys)) {
      allClaimKeys.set(def.qualifiedName, def);
    }
  }

  // Cross-feature role set — derived from handler-access rules + framework
  // built-ins ("all", "system"). We don't have a dedicated role-registry
  // (r.defineRoles is a type-level helper, not a runtime export), so we
  // use "referenced in any handler access rule" as the corpus of known
  // roles. The ownership-validator checks OwnershipMap keys + legacy
  // string[] field-access entries against this set — typos like "Admi"
  // instead of "Admin" fail at boot if nothing else ever mentions "Admi".
  const knownRoles = collectKnownRoles(features);

  // Cross-feature screen + nav registry — built once up front so per-feature
  // validators can check nav-ref targets + parent chains without re-scanning
  // every feature's navs map.
  const allScreenQns = collectScreenQns(features);
  const allNavQns = collectNavQns(features);
  const allWorkspaceQns = collectWorkspaceQns(features);
  const allWriteHandlerQns = collectWriteHandlerQns(features);
  const screensByShortId = collectScreensByShortId(features);
  validateScreenShortIdCollisions(screensByShortId);

  // Cross-feature API exposure-map — jedes Feature deklariert Marker via
  // r.exposesApi(name). Per-feature validateApiExposureMatching walkt
  // usedApis-Set und checkt dass jeder Eintrag hier einen Match findet.
  // Verhindert dass typo-getroffene oder gedroppte QN-Aufrufe zu
  // Runtime-Crash statt Boot-Fail werden.
  const allExposedApis = new Map<string, string>(); // apiName → providerFeature
  for (const f of features) {
    for (const apiName of f.exposedApis) {
      const existing = allExposedApis.get(apiName);
      if (existing && existing !== f.name) {
        throw new Error(
          `Cross-feature API "${apiName}" exposed by both "${existing}" and "${f.name}" — API names must be globally unique.`,
        );
      }
      allExposedApis.set(apiName, f.name);
    }
  }

  let hasEncryptedFields = false;
  let hasFileFields = false;

  for (const feature of features) {
    validateCircularDeps(feature.name, featureMap);
    if (validateEncryptedFields(feature)) hasEncryptedFields = true;
    if (validateFileFields(feature)) hasFileFields = true;
    validatePiiAndRetention(feature);
    validateApiExposureMatching(feature, allExposedApis, featureMap);
    validateEmbeddedFields(feature);
    validateMultiSelectFields(feature);
    validateReferenceFields(feature, featureMap);
    validateTransitions(feature);
    validateExtensionUsages(feature, extensionProviders);
    validateExtendSchemaCollisions(feature);
    validateDerivedFieldCollisions(feature);
    validateHandlerAccess(feature);
    validateLocatedTimestamps(feature);
    validateEntityIndexes(feature);
    validateConfigKeyBounds(feature);
    validateConfigKeyRequired(feature);
    validateConfigKeyComputed(feature);
    validateConfigKeyAllowPerRequest(feature);
    validateConfigKeyBacking(feature);
    validateOwnershipRules(feature, allClaimKeys, knownRoles);
    validateMultiStreamProjections(feature);
    validateScreens(
      feature,
      featureMap,
      allWriteHandlerQns,
      allScreenQns,
      allConfigKeyQns,
      screensByShortId,
    );
    validateNavs(feature, allScreenQns, allNavQns, allWorkspaceQns);
    validateWorkspaces(feature, allNavQns);
  }

  validateNavCycles(allNavQns);
  validateDefaultWorkspaceUniqueness(allWorkspaceQns);
  validateI18nSurfaceKeys(features);
  validateExtensionPreSaveWiring(features);
  validateGdprStoragePersistence(features);
  validateGdprHookCompleteness(features);

  if (hasEncryptedFields && !process.env["ENCRYPTION_KEY"]) {
    throw new Error("ENCRYPTION_KEY environment variable is required (encrypted fields in use)");
  }

  if (hasFileFields && !process.env["FILE_STORAGE_PROVIDER"]) {
    throw new Error(
      "FILE_STORAGE_PROVIDER environment variable is required (file/image fields in use)",
    );
  }

  validateConfigReads(features, allConfigKeys);
  warnOnToggleableDependencies(features, featureMap);
}
