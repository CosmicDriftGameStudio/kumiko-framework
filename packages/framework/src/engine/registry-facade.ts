import type { IncomingRelation, RegistryState } from "./registry-state";
import { filterByPhase, filterOwned } from "./registry-state";
import type {
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  ConfigKeyDefinition,
  ConfigSeedDef,
  EntityDefinition,
  EntityRelations,
  EventDef,
  FeatureDefinition,
  HookPhase,
  JobDefinition,
  MultiStreamProjectionDefinition,
  NavDefinition,
  NotificationDefinition,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ProjectionDefinition,
  QueryHandlerDef,
  RawTableDef,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  Registry,
  ScreenDefinition,
  SearchPayloadContributorFn,
  SecretKeyDefinition,
  TranslationKeys,
  TreeActionDef,
  WorkspaceDefinition,
  WriteHandlerDef,
} from "./types";

// Builds the public Registry surface (64 getters) bound to a specific
// RegistryState instance — pure move-diff from createRegistry's former
// return-object literal, only the closure-captured variable changed
// (state.X instead of bare X, done in the RegistryState-threading step).
export function buildRegistryFacade(state: RegistryState): Registry {
  return {
    features: state.featureMap,

    getFeature(name: string): FeatureDefinition | undefined {
      return state.featureMap.get(name);
    },

    hasRateLimitedHandler(): boolean {
      return state.hasRateLimitedHandlerCached;
    },

    getEntity(name: string): EntityDefinition | undefined {
      return state.entityMap.get(name);
    },

    getAllEntities(): ReadonlyMap<string, EntityDefinition> {
      return state.entityMap;
    },

    getWriteHandler(name: string): WriteHandlerDef | undefined {
      return state.writeHandlerMap.get(name);
    },

    getQueryHandler(name: string): QueryHandlerDef | undefined {
      return state.queryHandlerMap.get(name);
    },

    getSearchableFields(entityName: string): readonly string[] {
      return state.searchableFieldsCache.get(entityName) ?? [];
    },

    getSortableFields(entityName: string): readonly string[] {
      return state.sortableFieldsCache.get(entityName) ?? [];
    },

    getRelations(entityName: string): EntityRelations {
      return (state.relationMap.get(entityName) ?? {}) as EntityRelations; // @cast-boundary schema-walk
    },

    getSearchIncludes(entityName: string): ReadonlyMap<string, readonly string[]> {
      return state.searchIncludesCache.get(entityName) ?? new Map();
    },

    getIncomingRelations(entityName: string): readonly IncomingRelation[] {
      return state.incomingRelationsCache.get(entityName) ?? [];
    },

    getPreSaveHooks(
      name: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreSaveHookFn[] {
      return filterOwned(state.preSaveHooks.get(name), effectiveFeatures);
    },

    getPostSaveHooks(
      name: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostSaveHookFn[] {
      return filterByPhase(state.postSaveHooks.get(name), phase, effectiveFeatures);
    },

    getPreDeleteHooks(
      name: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreDeleteHookFn[] {
      return filterByPhase(state.preDeleteHooks.get(name), phase, effectiveFeatures);
    },

    getPostDeleteHooks(
      name: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostDeleteHookFn[] {
      return filterByPhase(state.postDeleteHooks.get(name), phase, effectiveFeatures);
    },

    getPreQueryHooks(
      name: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreQueryHookFn[] {
      return filterOwned(state.preQueryHooks.get(name), effectiveFeatures);
    },

    getPostQueryHooks(
      name: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostQueryHookFn[] {
      return filterOwned(state.postQueryHooks.get(name), effectiveFeatures);
    },

    // Entity hooks — fire for all writes on an entity
    getEntityPostSaveHooks(
      entityName: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostSaveHookFn[] {
      return filterByPhase(state.entityPostSaveHooks.get(entityName), phase, effectiveFeatures);
    },

    getEntityPreDeleteHooks(
      entityName: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreDeleteHookFn[] {
      return filterByPhase(state.entityPreDeleteHooks.get(entityName), phase, effectiveFeatures);
    },

    getEntityPostDeleteHooks(
      entityName: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostDeleteHookFn[] {
      return filterByPhase(state.entityPostDeleteHooks.get(entityName), phase, effectiveFeatures);
    },

    getEntityPostQueryHooks(
      entityName: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostQueryHookFn[] {
      return filterOwned(state.entityPostQueryHooks.get(entityName), effectiveFeatures);
    },

    // F3 — Search-Payload-Extension contributors for an entity. Used by
    // `buildSearchDocument` in system-hooks.ts to enrich the indexed payload.
    // `effectiveFeatures` filters out contributors owned by feature-toggle-
    // disabled features (parallel to getEntityPostQueryHooks etc.).
    getSearchPayloadExtensions(
      entityName: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly SearchPayloadContributorFn[] {
      return filterOwned(state.searchPayloadExtensions.get(entityName), effectiveFeatures);
    },

    getAllTranslations(): TranslationKeys {
      return state.mergedTranslations;
    },

    getHandlerEntity(qualifiedHandler: string): string | undefined {
      return state.handlerEntityMap.get(qualifiedHandler);
    },

    isHandlerSystemScoped(qualifiedHandler: string): boolean {
      const featureName = state.handlerFeatureMap.get(qualifiedHandler);
      if (!featureName) return false;
      return state.featureMap.get(featureName)?.systemScope ?? false;
    },

    getHandlerFeature(qualifiedHandler: string): string | undefined {
      return state.handlerFeatureMap.get(qualifiedHandler);
    },

    getAllMetrics() {
      return state.metricMap;
    },

    getAllSecretKeys(): ReadonlyMap<string, SecretKeyDefinition> {
      return state.secretKeyMap;
    },

    getSecretKey(qualifiedName: string): SecretKeyDefinition | undefined {
      return state.secretKeyMap.get(qualifiedName);
    },

    getConfigKey(qualifiedKey: string): ConfigKeyDefinition | undefined {
      return state.configKeyMap.get(qualifiedKey);
    },

    getAllConfigKeys(): ReadonlyMap<string, ConfigKeyDefinition> {
      return state.configKeyMap;
    },

    getJob(qualifiedName: string): JobDefinition | undefined {
      return state.jobMap.get(qualifiedName);
    },

    getAllJobs(): ReadonlyMap<string, JobDefinition> {
      return state.jobMap;
    },

    getEvent(qualifiedName: string): EventDef | undefined {
      return state.eventMap.get(qualifiedName);
    },

    getEventUpcasters() {
      return state.eventUpcasterMap;
    },

    getExtension(name: string): RegistrarExtensionDef | undefined {
      return state.extensionMap.get(name);
    },

    getExtensionUsages(extensionName: string): readonly RegistrarExtensionRegistration[] {
      return state.extensionUsages.filter((u) => u.extensionName === extensionName);
    },

    getAllExtensionSelectors(): ReadonlyMap<string, string> {
      return state.extensionSelectorMap;
    },

    getAllNotifications(): ReadonlyMap<string, NotificationDefinition> {
      return state.notificationMap;
    },

    getAllReferenceData(): readonly ReferenceDataDef[] {
      return state.allReferenceData;
    },

    getAllConfigSeeds(): readonly ConfigSeedDef[] {
      return state.allConfigSeeds;
    },

    getProjectionsForSource(entityName: string): readonly ProjectionDefinition[] {
      return state.projectionsBySource.get(entityName) ?? [];
    },

    getAllProjections(): ReadonlyMap<string, ProjectionDefinition> {
      return state.projectionMap;
    },

    getAllRawTables(): ReadonlyMap<string, RawTableDef> {
      return state.rawTableMap;
    },

    getAllMultiStreamProjections(): ReadonlyMap<string, MultiStreamProjectionDefinition> {
      return state.multiStreamProjectionMap;
    },

    getMultiStreamProjectionFeature(qualifiedName: string): string | undefined {
      return state.multiStreamProjectionFeatureMap.get(qualifiedName);
    },

    getAuthClaimsHooks(): readonly AuthClaimsHookDef[] {
      return state.authClaimsHooks;
    },

    getAllClaimKeys(): ReadonlyMap<string, ClaimKeyDefinition> {
      return state.claimKeyMap;
    },

    getClaimKey(qualifiedName: string): ClaimKeyDefinition | undefined {
      return state.claimKeyMap.get(qualifiedName);
    },

    getAllScreens(): ReadonlyMap<string, ScreenDefinition> {
      return state.screenMap;
    },

    getScreen(qualifiedName: string): ScreenDefinition | undefined {
      return state.screenMap.get(qualifiedName);
    },

    getScreenFeature(qualifiedName: string): string | undefined {
      return state.screenFeatureMap.get(qualifiedName);
    },

    getScreensByEntity(entityName: string): readonly ScreenDefinition[] {
      return state.screensByEntity.get(entityName) ?? [];
    },

    getAllNavs(): ReadonlyMap<string, NavDefinition> {
      return state.navMap;
    },

    getNav(qualifiedName: string): NavDefinition | undefined {
      return state.navMap.get(qualifiedName);
    },

    getNavFeature(qualifiedName: string): string | undefined {
      return state.navFeatureMap.get(qualifiedName);
    },

    getNavsByParent(parentQualifiedName: string): readonly NavDefinition[] {
      return state.navsByParent.get(parentQualifiedName) ?? [];
    },

    getTopLevelNavs(): readonly NavDefinition[] {
      return state.topLevelNavs;
    },

    getAllWorkspaces(): ReadonlyMap<string, WorkspaceDefinition> {
      return state.workspaceMap;
    },

    getWorkspace(qualifiedName: string): WorkspaceDefinition | undefined {
      return state.workspaceMap.get(qualifiedName);
    },

    getWorkspaceFeature(qualifiedName: string): string | undefined {
      return state.workspaceFeatureMap.get(qualifiedName);
    },

    getWorkspaceNavs(workspaceQualifiedName: string): readonly string[] {
      return state.navsByWorkspace.get(workspaceQualifiedName) ?? [];
    },

    getDefaultWorkspace(): WorkspaceDefinition | undefined {
      return state.defaultWorkspace;
    },

    getTreeActions(featureName: string): Readonly<Record<string, TreeActionDef>> | undefined {
      return state.treeActionsMap.get(featureName);
    },
  };
}
