import { validateExtensionPreSaveWiring } from "./boot-validator/entity-handler.js";
import { dedupeFeatures } from "./dedupe-features.js";
import { buildRegistryFacade } from "./registry-facade.js";
import {
  populateClaimsAndAuth,
  populateConfigKeys,
  populateEvents,
  populateExtensionsAndSeeds,
  populateFeatureCore,
  populateHandlers,
  populateHooks,
  populateJobsAndNotifications,
  populateMetricsAndSecrets,
  populateProjectionsAndTables,
  populateScreensNavWorkspaces,
  populateSystemEvents,
  populateTranslations,
} from "./registry-ingest.js";
import { createInitialState } from "./registry-state.js";
import {
  applyExtensionUsages,
  autoWireSoftDeleteJobs,
  buildEventUpcasterChains,
  buildImplicitProjections,
  buildIncomingRelations,
  buildSearchableSortableCaches,
  computeHasRateLimitedHandler,
  finalizeWorkspaceNavMembership,
  populateHandlerEntityMappings,
  publishEventPiiCatalog,
  resolveJobTriggers,
  resolveNotificationTriggersAndRegisterHooks,
  validateBootGates,
  validateEntityHookTargets,
  validateEventMigrationVersions,
  validateExtensionSelectors,
  validateExtensionUsageTargets,
  validateFieldAccessHandlersAreEntityMapped,
  validateJobBackoff,
  validateLifecycleHookTargets,
  validateLiveEntities,
  validateProjectionApplyKeys,
  validateRelationTargetsExist,
  validateRequiredFeatures,
} from "./registry-validate.js";
import type { FeatureDefinition, Registry } from "./types/index.js";

// This is where the magic happens. By "magic" I mean: precomputed maps.
// I build everything once at boot (hooks, relations, searchable fields, ...)
// so nothing has to iterate over objects at runtime. O(1) instead of O(n*m).
export function createRegistry(rawFeatures: readonly FeatureDefinition[]): Registry {
  const features = dedupeFeatures(rawFeatures);
  const state = createInitialState();

  for (const feature of features) {
    populateFeatureCore(state, feature);
    populateHandlers(state, feature);
    populateConfigKeys(state, feature);
    populateJobsAndNotifications(state, feature);
    populateEvents(state, feature);
    populateTranslations(state, feature);
    populateHooks(state, feature);
    populateExtensionsAndSeeds(state, feature);
    populateMetricsAndSecrets(state, feature);
    populateProjectionsAndTables(state, feature);
    populateClaimsAndAuth(state, feature);
    populateScreensNavWorkspaces(state, feature);
  }

  populateSystemEvents(state);
  finalizeWorkspaceNavMembership(state);
  populateHandlerEntityMappings(state, features);
  validateExtensionSelectors(state);
  applyExtensionUsages(state);
  buildSearchableSortableCaches(state);
  buildImplicitProjections(state, features);
  buildIncomingRelations(state);
  validateFieldAccessHandlersAreEntityMapped(state, features);
  validateExtensionPreSaveWiring(features);
  validateRelationTargetsExist(state);
  validateEventMigrationVersions(state, features);
  buildEventUpcasterChains(state, features);
  validateProjectionApplyKeys(state);
  validateRequiredFeatures(state, features);
  resolveNotificationTriggersAndRegisterHooks(state);
  validateLifecycleHookTargets(state);
  validateEntityHookTargets(state, features);
  resolveJobTriggers(state);
  validateBootGates(state);
  validateLiveEntities(state);
  validateJobBackoff(state);
  validateExtensionUsageTargets(state);
  computeHasRateLimitedHandler(state);
  publishEventPiiCatalog(state);
  autoWireSoftDeleteJobs(state);

  return buildRegistryFacade(state);
}
