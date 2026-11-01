import type {
  ConfigKeyDefinition,
  ConfigSeedDef,
  ExtensionSelectorPanel,
  JobDefinition,
  NotificationDefinition,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  TranslationKeys,
} from "@cosmicdrift/kumiko-types/config";
import type {
  SecretKeyDefinition,
  SecretNamespaceDefinition,
  StoreTableDef,
  WebhookEventContract,
} from "@cosmicdrift/kumiko-types/feature";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  EventDef,
  QueryHandlerDef,
  StreamHandlerDef,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-types/handlers";
import type {
  HookPhase,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  SearchPayloadContributorFn,
} from "@cosmicdrift/kumiko-types/hooks";
import type { NavDefinition } from "@cosmicdrift/kumiko-types/nav";
import type {
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
} from "@cosmicdrift/kumiko-types/projection";
import type { EntityRelations } from "@cosmicdrift/kumiko-types/relations";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import type { TreeActionDef } from "@cosmicdrift/kumiko-types/tree-node";
import type { WorkspaceDefinition } from "@cosmicdrift/kumiko-types/workspace";
import type {
  IncomingRelation,
  RegistryState,
  SearchableReferenceField,
  SortableReferenceField,
} from "./registry-state.ts";
import { filterByPhase, filterOwned } from "./registry-state.ts";
import type { FeatureDefinition, Registry } from "./types/index.ts";
import {
  assertUniqueWebhookWireNames,
  createWebhookContractResolver,
  type WebhookContractResolver,
} from "./webhook-contracts.ts";

function isFeatureSystemScoped(state: RegistryState, featureName: string | undefined): boolean {
  if (!featureName) return false;
  return state.featureMap.get(featureName)?.systemScope ?? false;
}

// Builds the public Registry surface (64 getters) bound to a specific
// RegistryState instance — pure move-diff from createRegistry's former
// return-object literal, only the closure-captured variable changed
// (state.X instead of bare X, done in the RegistryState-threading step).
export function buildRegistryFacade(state: RegistryState): Registry {
  assertUniqueWebhookWireNames([...state.featureMap.values()]);
  let resolver: WebhookContractResolver | undefined;
  const webhookContracts = (): WebhookContractResolver => {
    resolver ??= createWebhookContractResolver([...state.featureMap.values()]);
    return resolver;
  };
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

    getReadModelEntity(name: string): EntityDefinition | undefined {
      return state.readModelEntityMap.get(name)?.entity;
    },

    getReadModelEntityOwner(name: string): string | undefined {
      return state.readModelEntityMap.get(name)?.featureName;
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

    getAllQueryHandlers(): ReadonlyMap<string, QueryHandlerDef> {
      return state.queryHandlerMap;
    },

    getAllWriteHandlers(): ReadonlyMap<string, WriteHandlerDef> {
      return state.writeHandlerMap;
    },

    getStreamHandler(name: string): StreamHandlerDef | undefined {
      return state.streamHandlerMap.get(name);
    },

    getAllStreamHandlers(): ReadonlyMap<string, StreamHandlerDef> {
      return state.streamHandlerMap;
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

    getSearchableReferences(entityName: string): readonly SearchableReferenceField[] {
      return state.searchableReferencesCache.get(entityName) ?? [];
    },

    getSortableReferences(entityName: string): readonly SortableReferenceField[] {
      return state.sortableReferencesCache.get(entityName) ?? [];
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

    // Search-Payload-Extension contributors for an entity. Used by
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
      return isFeatureSystemScoped(state, state.handlerFeatureMap.get(qualifiedHandler));
    },

    isJobSystemScoped(qualifiedJobName: string): boolean {
      return isFeatureSystemScoped(state, state.jobFeatureMap.get(qualifiedJobName));
    },

    getHandlerFeature(qualifiedHandler: string): string | undefined {
      return state.handlerFeatureMap.get(qualifiedHandler);
    },

    getJobFeature(qualifiedJobName: string): string | undefined {
      return state.jobFeatureMap.get(qualifiedJobName);
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

    findSecretNamespace(key: string): SecretNamespaceDefinition | undefined {
      for (const [prefix, def] of state.secretNamespaceMap) {
        if (key.startsWith(prefix)) return def;
      }
      return undefined;
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

    getWebhookEventContract(qualifiedName: string): WebhookEventContract | undefined {
      return webhookContracts().get(qualifiedName);
    },

    getWebhookEventContracts(): readonly WebhookEventContract[] {
      return webhookContracts().declared();
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

    getExtensionSelectorPanels(extensionName: string): readonly ExtensionSelectorPanel[] {
      return state.extensionSelectorPanelsMap.get(extensionName) ?? [];
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

    getAllStoreTables(): ReadonlyMap<string, StoreTableDef> {
      return state.storeTableMap;
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
