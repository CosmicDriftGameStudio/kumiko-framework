import { applyEntityEvent } from "../db/apply-entity-event";
import { assertBackingTableSuperset, buildEntityTableMeta } from "../db/entity-table-meta";
import { asEntityTableMeta } from "../db/query";
import { buildEntityTable } from "../db/table-builder";
import { type QnType, qualifyEntityName } from "./qualified-name";
import type {
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  ConfigKeyDefinition,
  ConfigSeedDef,
  EntityDefinition,
  EntityProjectionExtension,
  EventDef,
  EventUpcastFn,
  FeatureDefinition,
  FeatureMetricDef,
  HookPhase,
  JobDefinition,
  MultiStreamProjectionDefinition,
  NavDefinition,
  NotificationDefinition,
  OwnedFn,
  PhasedHook,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ProjectionDefinition,
  QueryHandlerDef,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  RelationDefinition,
  ScreenDefinition,
  SearchPayloadContributorFn,
  SecretKeyDefinition,
  StoreTableDef,
  TreeActionDef,
  WorkspaceDefinition,
  WriteHandlerDef,
} from "./types";

export type IncomingRelation = {
  sourceEntity: string;
  relationName: string;
  relation: RelationDefinition;
};

const IMPLICIT_PROJECTION_SUFFIX = "-entity" as const;

// Pro r.entity-Registration eine ImplicitProjection mit auto-generierten
// apply-Handlern für die 4 Auto-Verben. Live-Pfad geht durch
// EventStoreExecutor und schreibt direkt in die Tabelle; rebuildProjection
// nutzt diese Definition um aus Events zu replayen. Beide rufen dieselbe
// applyEntityEvent-Funktion → Live==Rebuild by-construction (verstärkt
// durch implicit-projection-equivalence.integration.ts).
export function buildImplicitProjection(
  featureName: string,
  entityName: string,
  entity: EntityDefinition,
  qualify: typeof qualifyEntityName,
  backingTable?: unknown,
  extensions: readonly EntityProjectionExtension[] = [],
): ProjectionDefinition {
  const name = qualify(featureName, "projection", `${entityName}${IMPLICIT_PROJECTION_SUFFIX}`);
  // Backing table (r.entity(name, def, { table })) is the one physical table
  // object shared by executor-writes, rebuild-replay, test-push and
  // collectTableMetas — restoring the #255 invariant (test-push == generate).
  // Validated as a superset of the field-derived columns so a field/table
  // disagreement fails at boot, not as a silent thin-vs-rich row.
  const drizzleTable =
    backingTable !== undefined
      ? resolveBackingTable(entityName, entity, backingTable)
      : buildEntityTable(entityName, entity);
  // applyEntityEvent gibt ApplyResult zurück; SingleStreamApplyFn erwartet
  // Promise<void>. Im rebuild-Pfad ist die Row irrelevant — wir discarden.
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
  // Restore-Verb existiert nur für softDelete-Entities. Hard-Delete-
  // Entities sollten keine restored-Events produzieren — würden sie es
  // doch, würde applyEntityEvent intern als no-op laufen, aber wir
  // registrieren den Handler gar nicht erst.
  if (entity.softDelete) {
    apply[`${entityName}.restored`] = handler;
  }
  // r.extendEntityProjection: merge extension applies into the rebuild
  // replay. Collisions with lifecycle applies (or another extension) are
  // authoring bugs — fail at boot, not by silently overwriting a handler.
  const extraSources: string[] = [];
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
    for (const s of ext.sources ?? []) {
      if (s !== entityName && !extraSources.includes(s)) extraSources.push(s);
    }
  }
  return {
    name,
    source: entityName,
    ...(extraSources.length > 0 && { extraSources }),
    table: drizzleTable,
    apply,
    isImplicit: true,
  };
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
      `r.entity("${entityName}", …, { table }): the backing table carries no ` +
        "EntityTableMeta — build it via table() / buildEntityTable.",
    );
  }
  assertBackingTableSuperset(entityName, buildEntityTableMeta(entityName, entity), tableMeta);
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
  preSaveHooks: Map<string, OwnedFn<PreSaveHookFn>[]>;
  postSaveHooks: Map<string, PhasedHook<PostSaveHookFn>[]>;
  preDeleteHooks: Map<string, PhasedHook<PreDeleteHookFn>[]>;
  postDeleteHooks: Map<string, PhasedHook<PostDeleteHookFn>[]>;
  preQueryHooks: Map<string, OwnedFn<PreQueryHookFn>[]>;
  postQueryHooks: Map<string, OwnedFn<PostQueryHookFn>[]>;
  entityPostSaveHooks: Map<string, PhasedHook<PostSaveHookFn>[]>;
  entityPreDeleteHooks: Map<string, PhasedHook<PreDeleteHookFn>[]>;
  entityPostDeleteHooks: Map<string, PhasedHook<PostDeleteHookFn>[]>;
  entityPostQueryHooks: Map<string, OwnedFn<PostQueryHookFn>[]>;
  searchPayloadExtensions: Map<string, OwnedFn<SearchPayloadContributorFn>[]>;
  configKeyMap: Map<string, ConfigKeyDefinition>;
  jobMap: Map<string, JobDefinition>;
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
  allReferenceData: ReferenceDataDef[];
  allConfigSeeds: ConfigSeedDef[];
  mergedTranslations: Record<string, Record<string, string>>;
  metricMap: Map<string, FeatureMetricDef & { readonly featureName: string }>;
  secretKeyMap: Map<string, SecretKeyDefinition>;
  projectionMap: Map<string, ProjectionDefinition>;
  projectionsBySource: Map<string, ProjectionDefinition[]>;
  multiStreamProjectionMap: Map<string, MultiStreamProjectionDefinition>;
  multiStreamProjectionFeatureMap: Map<string, string>;
  storeTableMap: Map<string, StoreTableDef>;
  physicalTableOwners: Map<string, { kind: "entity" | "raw"; owner: string; featureName: string }>;
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
  searchIncludesCache: Map<string, ReadonlyMap<string, readonly string[]>>;
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
    preSaveHooks: new Map(),
    postSaveHooks: new Map(),
    preDeleteHooks: new Map(),
    postDeleteHooks: new Map(),
    preQueryHooks: new Map(),
    postQueryHooks: new Map(),
    entityPostSaveHooks: new Map(),
    entityPreDeleteHooks: new Map(),
    entityPostDeleteHooks: new Map(),
    entityPostQueryHooks: new Map(),
    searchPayloadExtensions: new Map(),
    configKeyMap: new Map(),
    jobMap: new Map(),
    notificationMap: new Map(),
    notificationFeatureMap: new Map(),
    eventMap: new Map(),
    eventUpcasterMap: new Map(),
    handlerEntityMap: new Map(),
    handlerFeatureMap: new Map(),
    extensionMap: new Map(),
    extensionUsages: [],
    extensionSelectorMap: new Map(),
    allReferenceData: [],
    allConfigSeeds: [],
    mergedTranslations: {},
    metricMap: new Map(),
    secretKeyMap: new Map(),
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
    searchIncludesCache: new Map(),
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
// (preSave, preQuery). Returns the raw fns ready for the lifecycle runner.
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
  // skip: optionaler entityHook-slot — features ohne postSave/preDelete/
  // postDelete/postQuery lassen das slot undefined.
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
  // skip: optionaler hook-slot — defineFeature materialisiert zwar alle
  // Slots, aber hand-gebaute Definitionen an System-Grenzen (Fixtures,
  // Partial-Boots, s. registry.test.ts) lassen sie weg. Leeres Record
  // statt Object.entries(undefined)-Crash.
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
