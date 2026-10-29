import type { ConfigKeyDefinition } from "@cosmicdrift/kumiko-types/config";
import { validateEntityFieldEncryptionAvailable } from "../../db/entity-field-encryption.ts";
import type { EnvelopeCipher } from "../../secrets/envelope-cipher.ts";
import { dedupeFeatures } from "../dedupe-features.ts";
import { FILE_STORAGE_PROVIDER_ENV } from "../extension-names.ts";
import { QnTypes, qualifyEntityName } from "../qualified-name.ts";
import type { FeatureDefinition } from "../types/index.ts";

import { validateProjectionAllowlist } from "../validate-projection-allowlist.ts";
import { validateAccessDeclarations } from "./access-declarations.ts";
import { warnOnUniqueAccessRoles } from "./access-roles.ts";
import { validateActionWiring, validateFieldWiring } from "./action-wiring.ts";
import { validateApiExposureMatching, validateExtensionUsages } from "./api-ext.ts";
import { validateFeatureBootChecks } from "./boot-check.ts";
import { validateCardMetaOverflow } from "./card-meta-overflow.ts";
import {
  validateCircularDeps,
  validateConfigKeyAllowPerRequest,
  validateConfigKeyBacking,
  validateConfigKeyBounds,
  validateConfigKeyComputed,
  validateConfigKeyOptionsQuery,
  validateConfigKeyPiiEncrypted,
  validateConfigKeyRequired,
  validateConfigReads,
  warnOnToggleableDependencies,
} from "./config-deps.ts";
import { validateSqlDerivedFields } from "./derived-sql-fields.ts";
import { collectDetailForScreens } from "./detail-screens.ts";
import {
  validateDerivedFieldCollisions,
  validateEmbeddedFields,
  validateEncryptedFields,
  validateEntityIndexes,
  validateEntitySelectAvailabilityQuery,
  validateEntitySelectConditionalOptions,
  validateEntitySelectOptionsQuery,
  validateExtendSchemaCollisions,
  validateExtensionPreSaveWiring,
  validateFileFields,
  validateHandlerAccess,
  validateImageVariants,
  validateLocatedTimestamps,
  validateLockedWhen,
  validateMultiSelectFields,
  validateMultiStreamProjections,
  validateReferenceFields,
  validateSearchableFieldReadAccess,
  validateTransitions,
} from "./entity-handler.ts";
import { validateEntityListScreens } from "./entity-list-screens.ts";
import { validateGdprStoragePersistence } from "./gdpr-storage.ts";
import { validateGlobalTenancyEntities } from "./global-tenancy.ts";
import { validateHandlerFieldReferences } from "./handler-field-references.ts";
import {
  validateI18nSurfaceKeys,
  validateRequiredLocales,
  validateTranslationLocaleConsistency,
} from "./i18n-keys.ts";
import {
  collectKnownRoles,
  collectNavQns,
  collectWriteHandlerQns,
  validateNavCycles,
  validateNavs,
  warnOnNavAccessInversion,
  warnOnUnreachableNavScreens,
} from "./nav.ts";
import { collectClaimKeys, validateOwnershipRules } from "./ownership.ts";
import { validateParentRefs } from "./parent-ref.ts";
import { validatePiiAndRetention } from "./pii-retention.ts";
import {
  buildQueryHandlerMap,
  validateProjectionListScreens,
  validateRelatedListSectionQueries,
} from "./projection-list-screens.ts";
import { validateQueryOutputColumns } from "./query-output-columns.ts";
import { validateQueryRefs } from "./query-refs.ts";
import { validateReadGates } from "./read-gate.ts";
import { validateRecordOwnedSubjects } from "./record-owned.ts";
import {
  collectScreenQns,
  collectScreensByShortId,
  validateScreenShortIdCollisions,
  validateScreens,
} from "./screens.ts";
import { warnOnMissingSecurityBaseline } from "./security-baseline.ts";
import { validateExtensionSelectorPanels } from "./selector-owner-panels.ts";
import { validateTransferGraph } from "./transfer-graph.ts";
import { validateSubmitPrefilledHiddenFields } from "./url-prefill-fields.ts";
import {
  collectWorkspaceQns,
  resolveNavAllowlist,
  validateDefaultWorkspaceUniqueness,
  validateWorkspaces,
} from "./workspaces.ts";

// Re-export: run-dev-app.ts needs this to pass write-handler QNs
// to codegen. It is not part of validateBoot, but uses the same
// extraction logic.
export { type CardMetaOverflow, collectCardMetaOverflow } from "./card-meta-overflow.ts";
export { validateAppCustomScreenWriteQns } from "./custom-screen-write-qns.ts";
export { collectWriteHandlerQns } from "./nav.ts";
export { SECURITY_BASELINE_FEATURE_NAMES } from "./security-baseline.ts";
export { MAX_TRANSFER_DEPTH } from "./transfer-graph.ts";

export type ValidateBootOptions = {
  /** Warn when an access role is used by exactly one handler/config-key/
   *  field across the whole boot scan — often a typo, but also the normal
   *  shape of a legitimate fine-grained role (one role scoped to one admin
   *  endpoint on purpose). Opt-in (default false): a default-on
   *  prod warning that nobody can silence per-role isn't worth the noise
   *  it generates on every boot. */
  readonly warnOnUniqueAccessRoles?: boolean;
  /** QNs the app's sidebar allowlist admits. When set, every declared nav
   *  whose screen isn't reachable from any allowlisted nav entry gets a
   *  boot-time warning — that screen would otherwise be silently
   *  unreachable via the sidebar. When omitted and the app has
   *  workspaces, the allowlist is derived from `r.workspace({ nav })` and
   *  `r.nav({ workspaces })` assignments instead. */
  readonly navAllowlist?: ReadonlySet<string>;
  /** Nav QNs deliberately left out of the sidebar allowlist because their
   *  screen is reachable another way (e.g. as a sub-page of a generated
   *  settings hub). Suppresses the navAllowlist warning for these QNs. */
  readonly navAllowlistExempt?: ReadonlySet<string>;
  /** Env the encrypted-field master-key probe reads. Defaults to
   *  `process.env`; runners pass their resolved env so a ciphertext-only
   *  key (already decrypted at boot) is visible to the probe. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The cipher the runner injects after validation (built from the app's
   *  `masterKey` or the env keyring). Satisfies the availability check for
   *  `encrypted: true` fields without an env KEK. */
  readonly entityFieldCipher?: EnvelopeCipher;
  /** Locales every translation key must carry across all mounted features
   *  (locale packages count). Without it a key can ship in one language and
   *  silently fall back at runtime for users of the others. */
  readonly requiredLocales?: readonly string[];
};

// Test stacks mount feature subsets, so a reference into a feature that is not
// mounted cannot be judged: it counts as present. A reference into a mounted
// feature must still resolve.
function mountedPrefixOf(qn: string): string {
  return qn.split(":", 1)[0] ?? qn;
}

class PrefixTolerantSet extends Set<string> {
  constructor(
    members: Iterable<string>,
    private readonly mountedFeatures: ReadonlySet<string>,
  ) {
    super(members);
  }
  override has(qn: string): boolean {
    return super.has(qn) || !this.mountedFeatures.has(mountedPrefixOf(qn));
  }
}

class PrefixTolerantMap<V> extends Map<string, V> {
  constructor(
    members: Iterable<readonly [string, V]>,
    private readonly mountedFeatures: ReadonlySet<string>,
  ) {
    super(members);
  }
  override has(qn: string): boolean {
    return super.has(qn) || !this.mountedFeatures.has(mountedPrefixOf(qn));
  }
}

/**
 * Subset-safe slice of validateBoot for test stacks: nav references (screen,
 * parent, workspace, tree actions), workspaces and nav cycles. The checks that
 * need the whole app composition (screens, ref entities) run only in validateBoot.
 */
export function validateNavBootSubset(rawFeatures: readonly FeatureDefinition[]): void {
  const features = dedupeFeatures(rawFeatures);
  const mounted: ReadonlySet<string> = new Set(features.map((f) => f.name));
  const allNavQns = collectNavQns(features);
  const tolerantScreens = new PrefixTolerantSet(collectScreenQns(features), mounted);
  const tolerantNavs = new PrefixTolerantMap(allNavQns, mounted);
  const tolerantWorkspaces = new PrefixTolerantMap(collectWorkspaceQns(features), mounted);
  for (const feature of features) {
    validateNavs(feature, tolerantScreens, tolerantNavs, tolerantWorkspaces);
    validateWorkspaces(feature, tolerantNavs);
  }
  validateNavCycles(allNavQns);
}

/**
 * Validates all feature configurations at boot time.
 * Throws on the first error found — fail fast.
 */
export function validateBoot(
  rawFeatures: readonly FeatureDefinition[],
  options?: ValidateBootOptions,
): void {
  const features = dedupeFeatures(rawFeatures);
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
  // Qualified config-key set for ConfigEditScreen validation. MUST be
  // canonicalized via qualifyEntityName (toKebab on feature + key), exactly
  // as define-feature/registry builds the QN. The raw f.configKeys key is
  // the camelCase object key (`brandingTitle`), but the actual QN is
  // `…:config:branding-title`; without toKebab, every configEdit screen
  // with a multi-word config key would fail incorrectly. allConfigKeys above
  // uses the older `feature.short` format for validateConfigReads.
  const configKeyDefsByQn = new Map<string, ConfigKeyDefinition>();
  for (const f of features) {
    for (const [key, def] of Object.entries(f.configKeys)) {
      allConfigKeys.add(`${f.name}.${key}`);
      configKeyDefsByQn.set(qualifyEntityName(f.name, QnTypes.config, key), def);
    }
  }

  // Collect all claim keys — the ownership-rule validator below resolves
  // `from("claim:<feature>:<key>")` strings against this map. Qualified name
  // is how the resolver / readClaim / ownership system all reference claims,
  // so we key on the qualifiedName here too.
  const allClaimKeys = collectClaimKeys(features);

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
  // Cross-feature entity → detailFor-screen map — built (+ uniqueness-
  // validated) up front so per-feature rowAction entity-targets
  // resolve against it inside the loop below, instead of at the very end
  // where this used to run.
  const detailForScreens = collectDetailForScreens(features, featureMap);
  validateSqlDerivedFields(features);

  // Cross-feature API exposure map — each feature declares markers via
  // r.exposesApi(name). Per-feature validateApiExposureMatching walks the
  // usedApis set and checks that every entry has a match here.
  // This prevents typoed or removed QN calls from causing a runtime crash
  // instead of a boot failure.
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

  // Registered query-handler QNs, built once for the per-feature reference
  // checks below (a reference field's `optionsQuery` may target any feature).
  const queryHandlerQns = buildQueryHandlerMap(features);

  let hasEncryptedFields = false;
  let hasFileFields = false;

  for (const feature of features) {
    validateCircularDeps(feature.name, featureMap);
    if (validateEncryptedFields(feature)) hasEncryptedFields = true;
    validateSearchableFieldReadAccess(feature);
    if (validateFileFields(feature)) hasFileFields = true;
    validatePiiAndRetention(feature);
    validateRecordOwnedSubjects(feature);
    validateApiExposureMatching(feature, allExposedApis, featureMap);
    validateEntitySelectOptionsQuery(feature);
    validateEntitySelectAvailabilityQuery(feature, queryHandlerQns);
    validateEntitySelectConditionalOptions(feature);
    validateEmbeddedFields(feature, featureMap, queryHandlerQns);
    validateMultiSelectFields(feature);
    validateImageVariants(feature);
    validateReferenceFields(feature, featureMap, queryHandlerQns);
    validateHandlerFieldReferences(feature, featureMap);
    validateTransitions(feature);
    validateLockedWhen(feature);
    validateExtensionUsages(feature, extensionProviders);
    validateExtendSchemaCollisions(feature);
    validateDerivedFieldCollisions(feature);
    validateHandlerAccess(feature);
    validateAccessDeclarations(feature);
    validateLocatedTimestamps(feature);
    validateEntityIndexes(feature);
    validateConfigKeyBounds(feature);
    validateConfigKeyRequired(feature);
    validateConfigKeyComputed(feature);
    validateConfigKeyAllowPerRequest(feature);
    validateConfigKeyBacking(feature);
    validateConfigKeyOptionsQuery(feature);
    validateConfigKeyPiiEncrypted(feature);
    validateOwnershipRules(feature, allClaimKeys, knownRoles);
    validateParentRefs(feature, featureMap);
    validateReadGates(feature, featureMap);
    validateTransferGraph(feature, featureMap);
    validateMultiStreamProjections(feature);
    // Before validateScreens: its visible/entityId field-reference checks throw
    // for a Function value first, with the confusing "unknown field undefined"
    // message (because `typeof fn !== "boolean"` is true), before the clear
    // Function check here can run.
    validateActionWiring(feature);
    validateFieldWiring(feature);
    validateScreens(
      feature,
      featureMap,
      allWriteHandlerQns,
      allScreenQns,
      configKeyDefsByQn,
      screensByShortId,
      detailForScreens,
    );
    validateNavs(feature, allScreenQns, allNavQns, allWorkspaceQns);
    validateWorkspaces(feature, allNavQns);
  }

  validateNavCycles(allNavQns);
  warnOnNavAccessInversion(allNavQns);
  const effectiveNavAllowlist = resolveNavAllowlist(
    options?.navAllowlist,
    allNavQns,
    allWorkspaceQns,
  );
  if (effectiveNavAllowlist !== undefined) {
    warnOnUnreachableNavScreens(
      allNavQns,
      effectiveNavAllowlist,
      options?.navAllowlistExempt,
      options?.navAllowlist === undefined ? "workspaces" : "explicit",
    );
  }
  validateDefaultWorkspaceUniqueness(allWorkspaceQns);
  validateI18nSurfaceKeys(features);
  validateTranslationLocaleConsistency(features);
  validateRequiredLocales(features, options?.requiredLocales);
  validateEntityListScreens(features);
  validateSubmitPrefilledHiddenFields(features);
  validateCardMetaOverflow(features);
  // Must run before validateProjectionListScreens: an unresolvable query
  // there is silently treated as "capability absent" and surfaces as a
  // misleading "no search parameter in its Zod schema" error instead of
  // the clear typo message below.
  validateQueryRefs(features);
  validateExtensionSelectorPanels(features);
  // Must also run after validateQueryRefs — column/field checks below
  // assume every `query` string already resolves to a registered handler.
  validateQueryOutputColumns(features);
  validateProjectionListScreens(features);
  validateRelatedListSectionQueries(features);
  validateExtensionPreSaveWiring(features);
  validateGdprStoragePersistence(features);
  validateGlobalTenancyEntities(features);
  validateFeatureBootChecks(features);
  validateProjectionAllowlist(features);

  if (hasEncryptedFields) {
    // Availability check, not env-presence: eagerly building the keyring
    // catches malformed keys (wrong length, bad base64) at boot instead of
    // on the first encrypted read in prod. An injected cipher (test seam,
    // custom KMS provider) satisfies the requirement without env keys.
    validateEntityFieldEncryptionAvailable(options?.env, options?.entityFieldCipher);
  }

  if (hasFileFields && !(options?.env ?? process.env)[FILE_STORAGE_PROVIDER_ENV]) {
    throw new Error(
      `${FILE_STORAGE_PROVIDER_ENV} environment variable is required (file/image fields in use)`,
    );
  }

  validateConfigReads(features, allConfigKeys);
  warnOnToggleableDependencies(features, featureMap);
  warnOnMissingSecurityBaseline(features);
  if (options?.warnOnUniqueAccessRoles === true) {
    warnOnUniqueAccessRoles(features);
  }
}
