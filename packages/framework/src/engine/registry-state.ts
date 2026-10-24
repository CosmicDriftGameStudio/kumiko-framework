import type {
  ConfigKeyDefinition,
  ConfigSeedDef,
  ExtensionSelectorPanel,
  JobDefinition,
  NotificationDefinition,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  TranslationValue,
} from "@cosmicdrift/kumiko-types/config";
import type {
  FeatureMetricDef,
  SecretKeyDefinition,
  SecretNamespaceDefinition,
  StoreTableDef,
} from "@cosmicdrift/kumiko-types/feature";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  EventDef,
  EventUpcastFn,
  QueryHandlerDef,
  StreamHandlerDef,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-types/handlers";
import type {
  HookPhase,
  OwnedFn,
  PhasedHook,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  SearchPayloadContributorFn,
} from "@cosmicdrift/kumiko-types/hooks";
import type { NavDefinition } from "@cosmicdrift/kumiko-types/nav";
import type {
  EntityProjectionExtension,
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
  ProjectionRowIdOf,
} from "@cosmicdrift/kumiko-types/projection";
import type { RelationDefinition } from "@cosmicdrift/kumiko-types/relations";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import type { TreeActionDef } from "@cosmicdrift/kumiko-types/tree-node";
import type { WorkspaceDefinition } from "@cosmicdrift/kumiko-types/workspace";
import { applyEntityEvent } from "../db/apply-entity-event.ts";
import { assertBackingTableSuperset, deriveEntityTableMeta } from "../db/entity-table-meta.ts";
import { markExecutorManagedTable } from "../db/executor-managed-tables.ts";
import { asEntityTableMeta } from "../db/query.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import { type QnType, qualifyEntityName } from "./qualified-name.ts";
import type { FeatureDefinition } from "./types/index.ts";

export type IncomingRelation = {
  sourceEntity: string;
  relationName: string;
  relation: RelationDefinition;
};

// One entry per `ReferenceFieldDef` with `searchable: true` —
// resolved once at boot so the read-path never re-parses `field.entity`
// per request. `labelField` is guaranteed defined here: buildSearchableSortableCaches
// throws at boot for a searchable reference missing an explicit labelField
// (the "id" default is a UUID column, ILIKE against it would 500 at request time).
export type SearchableReferenceField = {
  readonly fieldName: string;
  readonly targetEntityName: string;
  readonly labelField: string;
};

// One entry per `ReferenceFieldDef` with `sortable: true`. Same
// resolved shape as the searchable variant and the same boot guarantee on
// `labelField` — ORDER BY on the UUID column would look meaningful and be
// arbitrary.
export type SortableReferenceField = SearchableReferenceField;

const IMPLICIT_PROJECTION_SUFFIX = "-entity" as const;

// Each `r.entity` registration gets an implicit projection with generated
// apply handlers for the four automatic verbs. The live path writes directly
// to the table through EventStoreExecutor, while rebuildProjection replays
// events through this definition. Both call applyEntityEvent, ensuring live
// and rebuild use the same logic (also covered by
// implicit-projection-equivalence.integration.ts).
export function buildImplicitProjection(
  featureName: string,
  entityName: string,
  entity: EntityDefinition,
  qualify: typeof qualifyEntityName,
  backingTable?: unknown,
  extensions: readonly EntityProjectionExtension[] = [],
): ProjectionDefinition {
  const name = qualify(featureName, "projection", `${entityName}${IMPLICIT_PROJECTION_SUFFIX}`);
  // Backing table (r.entity({ name, ...def, backingTable })) is the one physical table
  // object shared by executor-writes, rebuild-replay, test-push and
  // collectTableMetas — restoring the invariant (test-push == generate).
  // Validated as a superset of the field-derived columns so a field/table
  // disagreement fails at boot, not as a silent thin-vs-rich row.
  const drizzleTable =
    backingTable !== undefined
      ? resolveBackingTable(entityName, entity, backingTable)
      : buildEntityTable(entityName, entity);
  markExecutorManagedTable(drizzleTable, { entityName, entity });
  // applyEntityEvent returns ApplyResult, but SingleStreamApplyFn expects
  // Promise<void>. The row is irrelevant during rebuild, so we discard it.
  const handler = async (
    event: Parameters<ProjectionDefinition["apply"][string]>[0],
    tx: Parameters<ProjectionDefinition["apply"][string]>[1],
  ): Promise<void> => {
    await applyEntityEvent(event, drizzleTable, entity, tx);
  };
  const apply: Record<string, ProjectionDefinition["apply"][string]> = {
    [`${entityName}.created`]: handler,
    [`${entityName}.updated`]: handler,
    [`${entityName}.deleted`]: handler,
    // forget/purge (Art. 17): hard-deletes the row even for softDelete entities.
    // Registered for every entity so the erasure replays on rebuild.
    [`${entityName}.forgotten`]: handler,
  };
  // The restore verb exists only for softDelete entities. Hard-delete entities
  // should not produce restored events; if they did, applyEntityEvent would
  // treat them as a no-op, so the handler is not registered.
  if (entity.softDelete) {
    apply[`${entityName}.restored`] = handler;
  }
  // r.extendEntityProjection: merge extension applies into the rebuild
  // replay. Collisions with lifecycle applies (or another extension) are
  // authoring bugs — fail at boot, not by silently overwriting a handler.
  for (const ext of extensions) {
    for (const [eventType, fn] of Object.entries(ext.apply)) {
      if (apply[eventType]) {
        throw new Error(
          `Implicit projection "${name}": extendEntityProjection apply-key "${eventType}" ` +
            `collides with an existing handler (entity lifecycle apply or another extension).`,
        );
      }
      apply[eventType] = fn;
    }
  }
  const { extraSources, extraSourceRowIds } = collectExtensionSources(name, entityName, extensions);
  return {
    name,
    source: entityName,
    ...(extraSources.length > 0 && { extraSources }),
    ...(Object.keys(extraSourceRowIds).length > 0 && { extraSourceRowIds }),
    table: drizzleTable,
    apply,
    isImplicit: true,
  };
}

function assertRowIdOfSources(
  projectionName: string,
  entityName: string,
  ext: EntityProjectionExtension,
): void {
  // skip: extension maps no rowIdOf, nothing to validate
  if (ext.rowIdOf === undefined) return;
  const sources = ext.sources ?? [];
  if (sources.length === 0) {
    throw new Error(
      `Implicit projection "${projectionName}": extendEntityProjection declares rowIdOf without ` +
        `\`sources\` — rowIdOf maps events of the declared sources to row ids.`,
    );
  }
  if (sources.includes(entityName)) {
    throw new Error(
      `Implicit projection "${projectionName}": extendEntityProjection rowIdOf cannot apply to the ` +
        `entity's own stream "${entityName}" — host-stream rows are keyed by the aggregate id.`,
    );
  }
}

function collectExtensionSources(
  projectionName: string,
  entityName: string,
  extensions: readonly EntityProjectionExtension[],
): { extraSources: string[]; extraSourceRowIds: Record<string, ProjectionRowIdOf> } {
  const extraSources: string[] = [];
  const extraSourceRowIds: Record<string, ProjectionRowIdOf> = {};
  const rowIdDeclaredBy = new Map<string, ProjectionRowIdOf | undefined>();
  for (const ext of extensions) {
    for (const s of ext.sources ?? []) {
      if (s !== entityName && !extraSources.includes(s)) extraSources.push(s);
    }
    assertRowIdOfSources(projectionName, entityName, ext);
    for (const s of ext.sources ?? []) {
      if (rowIdDeclaredBy.has(s) && rowIdDeclaredBy.get(s) !== ext.rowIdOf) {
        throw new Error(
          `Implicit projection "${projectionName}": source "${s}" is declared by several extensions with ` +
            `different or missing rowIdOf — the row id for its events is ambiguous.`,
        );
      }
      rowIdDeclaredBy.set(s, ext.rowIdOf);
      if (ext.rowIdOf !== undefined) extraSourceRowIds[s] = ext.rowIdOf;
    }
  }
  return { extraSources, extraSourceRowIds };
}

// Validates a r.entity backing table is a superset of the entity's field-
// derived columns, then hands it back as the projection table. The cast is a
// system-boundary reconstitution: the table is stored as `unknown` on
// FeatureDefinition only to keep drizzle out of the plain-data shape, and
// asEntityTableMeta confirms the kumiko-table shape at runtime.
function resolveBackingTable(
  entityName: string,
  entity: EntityDefinition,
  backingTable: unknown,
): ProjectionDefinition["table"] {
  const tableMeta = asEntityTableMeta(backingTable);
  if (!tableMeta) {
    throw new Error(
      `r.entity({ name: "${entityName}", …, backingTable }): the backing table carries no ` +
        "EntityTableMeta — build it via table() / buildEntityTable.",
    );
  }
  assertBackingTableSuperset(entityName, deriveEntityTableMeta(entityName, entity), tableMeta);
  return backingTable as ProjectionDefinition["table"];
}

// Local alias for readability — `qualifyEntityName` is the shared helper
// from qualified-name.ts, also used by validateBoot to keep ingest and
// validation in lockstep on the qualification rule. Module-scope: stateless,
// no RegistryState threading needed.
export const qualify = qualifyEntityName;

// Bundles every Map/Set/array/scalar createRegistry populates during ingest —
// hoisted to module scope out of createRegistry's former closure, so the
// populateX/validateX phase-functions below can read/write them explicitly
// instead of via implicit capture. Every field is held BY REFERENCE (the
// actual Map/Set/array instance, never a destructured copy) — populateX
// functions mutate the same instance across calls for the same registry
// build. See docs/plans/god-files-refactor.md for the by-reference invariant.
export type RegistryState = {
  featureMap: Map<string, FeatureDefinition>;
  entityMap: Map<string, EntityDefinition>;
  relationMap: Map<string, Record<string, RelationDefinition>>;
  writeHandlerMap: Map<string, WriteHandlerDef>;
  queryHandlerMap: Map<string, QueryHandlerDef>;
  streamHandlerMap: Map<string, StreamHandlerDef>;
  preSaveHooks: Map<string, OwnedFn<PreSaveHookFn>[]>;
  postSaveHooks: Map<string, PhasedHook<PostSaveHookFn>[]>;
  preDeleteHooks: Map<string, PhasedHook<PreDeleteHookFn>[]>;
  postDeleteHooks: Map<string, PhasedHook<PostDeleteHookFn>[]>;
  postQueryHooks: Map<string, OwnedFn<PostQueryHookFn>[]>;
  entityPostSaveHooks: Map<string, PhasedHook<PostSaveHookFn>[]>;
  entityPreDeleteHooks: Map<string, PhasedHook<PreDeleteHookFn>[]>;
  entityPostDeleteHooks: Map<string, PhasedHook<PostDeleteHookFn>[]>;
  entityPostQueryHooks: Map<string, OwnedFn<PostQueryHookFn>[]>;
  searchPayloadExtensions: Map<string, OwnedFn<SearchPayloadContributorFn>[]>;
  configKeyMap: Map<string, ConfigKeyDefinition>;
  jobMap: Map<string, JobDefinition>;
  jobFeatureMap: Map<string, string>;
  notificationMap: Map<string, NotificationDefinition>;
  notificationFeatureMap: Map<string, string>;
  eventMap: Map<string, EventDef>;
  eventUpcasterMap: Map<
    string,
    { readonly currentVersion: number; readonly chain: ReadonlyMap<number, EventUpcastFn> }
  >;
  handlerEntityMap: Map<string, string>;
  handlerFeatureMap: Map<string, string>;
  extensionMap: Map<string, RegistrarExtensionDef>;
  extensionUsages: RegistrarExtensionRegistration[];
  extensionSelectorMap: Map<string, string>;
  extensionSelectorPanelsMap: Map<string, readonly ExtensionSelectorPanel[]>;
  allReferenceData: ReferenceDataDef[];
  allConfigSeeds: ConfigSeedDef[];
  mergedTranslations: Record<string, Record<string, TranslationValue>>;
  metricMap: Map<string, FeatureMetricDef & { readonly featureName: string }>;
  secretKeyMap: Map<string, SecretKeyDefinition>;
  secretNamespaceMap: Map<string, SecretNamespaceDefinition>;
  projectionMap: Map<string, ProjectionDefinition>;
  projectionsBySource: Map<string, ProjectionDefinition[]>;
  multiStreamProjectionMap: Map<string, MultiStreamProjectionDefinition>;
  multiStreamProjectionFeatureMap: Map<string, string>;
  storeTableMap: Map<string, StoreTableDef>;
  physicalTableOwners: Map<
    string,
    { kind: "entity" | "store"; owner: string; featureName: string }
  >;
  authClaimsHooks: AuthClaimsHookDef[];
  claimKeyMap: Map<string, ClaimKeyDefinition>;
  screenMap: Map<string, ScreenDefinition>;
  screenFeatureMap: Map<string, string>;
  screensByEntity: Map<string, ScreenDefinition[]>;
  navMap: Map<string, NavDefinition>;
  navFeatureMap: Map<string, string>;
  navsByParent: Map<string, NavDefinition[]>;
  topLevelNavs: NavDefinition[];
  workspaceMap: Map<string, WorkspaceDefinition>;
  workspaceFeatureMap: Map<string, string>;
  navsByWorkspace: Map<string, string[]>;
  defaultWorkspace: WorkspaceDefinition | undefined;
  treeActionsMap: Map<string, Readonly<Record<string, TreeActionDef>>>;
  searchableFieldsCache: Map<string, readonly string[]>;
  sortableFieldsCache: Map<string, readonly string[]>;
  searchableReferencesCache: Map<string, readonly SearchableReferenceField[]>;
  sortableReferencesCache: Map<string, readonly SortableReferenceField[]>;
  incomingRelationsCache: Map<string, IncomingRelation[]>;
  hasRateLimitedHandlerCached: boolean;
};

export function createInitialState(): RegistryState {
  return {
    featureMap: new Map(),
    entityMap: new Map(),
    relationMap: new Map(),
    writeHandlerMap: new Map(),
    queryHandlerMap: new Map(),
    streamHandlerMap: new Map(),
    preSaveHooks: new Map(),
    postSaveHooks: new Map(),
    preDeleteHooks: new Map(),
    postDeleteHooks: new Map(),
    postQueryHooks: new Map(),
    entityPostSaveHooks: new Map(),
    entityPreDeleteHooks: new Map(),
    entityPostDeleteHooks: new Map(),
    entityPostQueryHooks: new Map(),
    searchPayloadExtensions: new Map(),
    configKeyMap: new Map(),
    jobMap: new Map(),
    jobFeatureMap: new Map(),
    notificationMap: new Map(),
    notificationFeatureMap: new Map(),
    eventMap: new Map(),
    eventUpcasterMap: new Map(),
    handlerEntityMap: new Map(),
    handlerFeatureMap: new Map(),
    extensionMap: new Map(),
    extensionUsages: [],
    extensionSelectorMap: new Map(),
    extensionSelectorPanelsMap: new Map(),
    allReferenceData: [],
    allConfigSeeds: [],
    mergedTranslations: {},
    metricMap: new Map(),
    secretKeyMap: new Map(),
    secretNamespaceMap: new Map(),
    projectionMap: new Map(),
    projectionsBySource: new Map(),
    multiStreamProjectionMap: new Map(),
    multiStreamProjectionFeatureMap: new Map(),
    storeTableMap: new Map(),
    physicalTableOwners: new Map(),
    authClaimsHooks: [],
    claimKeyMap: new Map(),
    screenMap: new Map(),
    screenFeatureMap: new Map(),
    screensByEntity: new Map(),
    navMap: new Map(),
    navFeatureMap: new Map(),
    navsByParent: new Map(),
    topLevelNavs: [],
    workspaceMap: new Map(),
    workspaceFeatureMap: new Map(),
    navsByWorkspace: new Map(),
    defaultWorkspace: undefined,
    treeActionsMap: new Map(),
    searchableFieldsCache: new Map(),
    sortableFieldsCache: new Map(),
    searchableReferencesCache: new Map(),
    sortableReferencesCache: new Map(),
    incomingRelationsCache: new Map(),
    hasRateLimitedHandlerCached: false,
  };
}

// Filter hooks by phase and/or owning feature.
//
// - `phase === undefined` → any phase passes.
// - `effectiveFeatures === undefined` → ownership filter disabled.
// - hook.featureName === "*" or undefined → always passes ownership filter.
//   "*" is reserved for extension-provided hooks that are invariant
//   plumbing, not opt-in feature logic.
export function filterByPhase<TFn>(
  list: readonly PhasedHook<TFn>[] | undefined,
  phase: HookPhase | undefined,
  effectiveFeatures?: ReadonlySet<string>,
): readonly TFn[] {
  if (!list || list.length === 0) return [];
  const result: TFn[] = [];
  for (const entry of list) {
    if (phase !== undefined && entry.phase !== phase) continue;
    if (!ownerEnabled(entry.featureName, effectiveFeatures)) continue;
    result.push(entry.fn);
  }
  return result;
}

// Same ownership rule as filterByPhase, but for unphased hook lists
// (preSave, postQuery). Returns the raw fns ready for the lifecycle runner.
export function filterOwned<TFn>(
  list: readonly OwnedFn<TFn>[] | undefined,
  effectiveFeatures?: ReadonlySet<string>,
): readonly TFn[] {
  if (!list || list.length === 0) return [];
  const result: TFn[] = [];
  for (const entry of list) {
    if (!ownerEnabled(entry.featureName, effectiveFeatures)) continue;
    result.push(entry.fn);
  }
  return result;
}

function ownerEnabled(
  owner: string | undefined,
  effectiveFeatures: ReadonlySet<string> | undefined,
): boolean {
  if (!effectiveFeatures) return true;
  if (owner === undefined || owner === "*") return true;
  return effectiveFeatures.has(owner);
}

// Merge hooks without prefix (entity hooks). featureName is already on
// every hook entry (set by defineFeature), so there's no parallel
// bookkeeping — just append.
export function mergeHookList<T>(
  map: Map<string, T[]>,
  source: Readonly<Record<string, readonly T[]>> | undefined,
): void {
  // skip: the optional entity-hook slot may be undefined when a feature has no
  // postSave, preDelete, postDelete, or postQuery hooks.
  if (!source) return;
  for (const [name, fns] of Object.entries(source)) {
    const existing = map.get(name) ?? [];
    existing.push(...fns);
    map.set(name, existing);
  }
}

// Merge hooks with feature prefix (handler hooks).
// Hook keys are handler QNs — hooks don't get their own QN, they're keyed by the handler they target.
// The hookQnType indicates whether the targeted handler is a write or query handler.
export function mergeHookListQualified<T>(
  map: Map<string, T[]>,
  source: Readonly<Record<string, readonly T[]>> | undefined,
  featureName: string,
  hookQnType: QnType,
): void {
  // skip: the optional hook slot may be omitted by hand-built definitions at
  // system boundaries (fixtures and partial boots), even though defineFeature
  // materializes every slot. This avoids Object.entries(undefined) crashing.
  if (!source) return;
  for (const [name, fns] of Object.entries(source)) {
    const qualified = qualify(featureName, hookQnType, name);
    const existing = map.get(qualified) ?? [];
    existing.push(...fns);
    map.set(qualified, existing);
  }
}

/** Returns true if any entity in the feature has field-level access rules (read or write). */
export function hasFieldAccessRules(feature: FeatureDefinition): boolean {
  for (const entity of Object.values(feature.entities ?? {})) {
    for (const field of Object.values(entity.fields)) {
      if (field.access?.read?.length || field.access?.write?.length) {
        return true;
      }
    }
  }
  return false;
}
