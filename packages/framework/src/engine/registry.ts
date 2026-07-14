import { validateExtensionPreSaveWiring } from "./boot-validator/entity-handler";
import { buildRegistryFacade } from "./registry-facade";
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
  populateTranslations,
} from "./registry-ingest";
import { createInitialState } from "./registry-state";
import {
  applyExtensionUsages,
  autoWireSoftDeleteJobs,
  buildEventUpcasterChains,
  buildImplicitProjections,
  buildSearchableSortableCaches,
  buildSearchIncludesAndIncomingRelations,
  computeHasRateLimitedHandler,
  finalizeWorkspaceNavMembership,
  populateHandlerEntityMappings,
  publishEventPiiCatalog,
  resolveNotificationTriggersAndRegisterHooks,
  validateEntityHookTargets,
  validateEventMigrationVersions,
  validateExtensionSelectors,
  validateExtensionUsageTargets,
  validateFieldAccessHandlersAreEntityMapped,
  validateJobTriggers,
  validateLifecycleHookTargets,
  validateNoRawTableProjectionClash,
  validateProjectionApplyKeys,
  validateRelationTargetsExist,
  validateRequiredFeatures,
} from "./registry-validate";
import type { FeatureDefinition, Registry } from "./types";

// This is where the magic happens. By "magic" I mean: precomputed maps.
// I build everything once at boot (hooks, relations, searchable fields, ...)
// so nothing has to iterate over objects at runtime. O(1) instead of O(n*m).
export function createRegistry(features: readonly FeatureDefinition[]): Registry {
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

  finalizeWorkspaceNavMembership(state);
  populateHandlerEntityMappings(state, features);
  validateExtensionSelectors(state);
  applyExtensionUsages(state);
  buildSearchableSortableCaches(state);
  buildImplicitProjections(state, features);
  validateNoRawTableProjectionClash(state);
  buildSearchIncludesAndIncomingRelations(state);
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
  validateJobTriggers(state);
  validateExtensionUsageTargets(state);
  computeHasRateLimitedHandler(state);
  publishEventPiiCatalog(state);
  autoWireSoftDeleteJobs(state);

  return buildRegistryFacade(state);
}
