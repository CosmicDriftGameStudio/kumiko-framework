import { configureEventPiiCatalog } from "../crypto/event-pii";
import { applyEntityEvent } from "../db/apply-entity-event";
import {
  assertBackingTableSuperset,
  buildEntityTableMeta,
  resolveTableName,
} from "../db/entity-table-meta";
import { asEntityTableMeta } from "../db/query";
import { buildEntityTable } from "../db/table-builder";
import { buildMetricName, validateMetricName } from "../observability";
import { validateExtensionPreSaveWiring } from "./boot-validator/entity-handler";
import { type QnType, qualifyEntityName } from "./qualified-name";
import {
  buildSoftDeleteCleanupJob,
  buildSoftDeleteCleanupSystemJob,
  SOFT_DELETE_CLEANUP_JOB,
  SOFT_DELETE_CLEANUP_SYSTEM_JOB,
  SOFT_DELETE_GRACE_DAYS_KEY,
  softDeleteGraceDaysConfig,
} from "./soft-delete-cleanup";
import type {
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  ConfigKeyDefinition,
  ConfigSeedDef,
  EntityDefinition,
  EntityProjectionExtension,
  EntityRelations,
  EventDef,
  EventPiiFields,
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
  RawTableDef,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  Registry,
  RelationDefinition,
  ScreenDefinition,
  SearchPayloadContributorFn,
  SecretKeyDefinition,
  TranslationKeys,
  TreeActionDef,
  UnmanagedTableDef,
  WorkspaceDefinition,
  WriteHandlerDef,
} from "./types";
import { HookPhases } from "./types";
import { resolveName } from "./types/handlers";

type IncomingRelation = {
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
function buildImplicitProjection(
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
const qualify = qualifyEntityName;

// Bundles every Map/Set/array/scalar createRegistry populates during ingest —
// hoisted to module scope out of createRegistry's former closure, so the
// populateX/validateX phase-functions below can read/write them explicitly
// instead of via implicit capture. Every field is held BY REFERENCE (the
// actual Map/Set/array instance, never a destructured copy) — populateX
// functions mutate the same instance across calls for the same registry
// build. See docs/plans/god-files-refactor.md for the by-reference invariant.
type RegistryState = {
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
  rawTableMap: Map<string, RawTableDef>;
  unmanagedTableMap: Map<string, UnmanagedTableDef>;
  physicalTableOwners: Map<
    string,
    { kind: "entity" | "unmanaged"; owner: string; featureName: string }
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
  searchIncludesCache: Map<string, ReadonlyMap<string, readonly string[]>>;
  incomingRelationsCache: Map<string, IncomingRelation[]>;
  hasRateLimitedHandlerCached: boolean;
};

function createInitialState(): RegistryState {
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
    rawTableMap: new Map(),
    unmanagedTableMap: new Map(),
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
function filterByPhase<TFn>(
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
function filterOwned<TFn>(
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
function mergeHookList<T>(
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
function mergeHookListQualified<T>(
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

// Feature registration + entities (globally-unique, physical-table-checked) + relations
// (additive per entity, duplicate-per-name guarded).
function populateFeatureCore(state: RegistryState, feature: FeatureDefinition): void {
  if (state.featureMap.has(feature.name)) {
    throw new Error(`Duplicate feature: "${feature.name}"`);
  }
  state.featureMap.set(feature.name, feature);

  // Entities: NOT prefixed — entity names must be globally unique
  for (const [name, entity] of Object.entries(feature.entities ?? {})) {
    if (state.entityMap.has(name)) {
      throw new Error(`Duplicate entity: "${name}" (registered by multiple features)`);
    }
    state.entityMap.set(name, entity);
    const physical = resolveTableName(name, entity, feature.name);
    const clash = state.physicalTableOwners.get(physical);
    if (clash?.kind === "unmanaged") {
      throw new Error(
        `Entity "${name}" (feature "${feature.name}") has physical table "${physical}" which ` +
          `collides with r.unmanagedTable("${physical}") (feature "${clash.featureName}"). ` +
          `Pick a different tableName — both would emit CREATE TABLE "${physical}".`,
      );
    }
    // Entity-vs-entity ist genauso fatal: zwei Entities mit explizitem,
    // identischem tableName überschrieben sich hier vorher still —
    // doppeltes CREATE TABLE bzw. eine Projektion frisst die andere.
    if (clash?.kind === "entity") {
      throw new Error(
        `Entity "${name}" (feature "${feature.name}") has physical table "${physical}" which ` +
          `collides with entity "${clash.owner}" (feature "${clash.featureName}"). ` +
          `Pick a different tableName — both would project into "${physical}".`,
      );
    }
    state.physicalTableOwners.set(physical, {
      kind: "entity",
      owner: name,
      featureName: feature.name,
    });
  }

  // Relations: entityName (not prefixed)
  for (const [entityName, rels] of Object.entries(feature.relations ?? {})) {
    const existing = state.relationMap.get(entityName) ?? {};
    for (const [relName, relDef] of Object.entries(rels)) {
      if (existing[relName]) {
        throw new Error(
          `Duplicate relation: "${entityName}.${relName}" (registered by multiple features)`,
        );
      }
      existing[relName] = relDef;
    }
    state.relationMap.set(entityName, existing);
  }
}

// Write + query handlers: qualified scope:type:name, duplicate-guarded.
function populateHandlers(state: RegistryState, feature: FeatureDefinition): void {
  // Write handlers: scope:write:name
  for (const [name, handler] of Object.entries(feature.writeHandlers ?? {})) {
    const qualified = qualify(feature.name, "write", name);
    if (state.writeHandlerMap.has(qualified)) {
      throw new Error(`Duplicate write handler: "${qualified}" (registered by multiple features)`);
    }
    state.writeHandlerMap.set(qualified, { ...handler, name: qualified });
    state.handlerFeatureMap.set(qualified, feature.name);
  }

  // Query handlers: scope:query:name
  for (const [name, handler] of Object.entries(feature.queryHandlers ?? {})) {
    const qualified = qualify(feature.name, "query", name);
    if (state.queryHandlerMap.has(qualified)) {
      throw new Error(`Duplicate query handler: "${qualified}" (registered by multiple features)`);
    }
    state.queryHandlerMap.set(qualified, { ...handler, name: qualified });
    state.handlerFeatureMap.set(qualified, feature.name);
  }
}

// Config keys: scope:config:name, duplicate-guarded.
function populateConfigKeys(state: RegistryState, feature: FeatureDefinition): void {
  // Config keys: scope:config:name
  for (const [key, keyDef] of Object.entries(feature.configKeys ?? {})) {
    const qualifiedKey = qualify(feature.name, "config", key);
    if (state.configKeyMap.has(qualifiedKey)) {
      throw new Error(`Duplicate config key: "${qualifiedKey}" (registered by multiple features)`);
    }
    state.configKeyMap.set(qualifiedKey, keyDef);
  }
}

// Jobs (runIn-pinned, duplicate-guarded) + notifications (trigger resolved later).
function populateJobsAndNotifications(state: RegistryState, feature: FeatureDefinition): void {
  // Jobs: scope:job:name
  for (const [name, jobDef] of Object.entries(feature.jobs ?? {})) {
    const qualifiedName = qualify(feature.name, "job", name);
    if (state.jobMap.has(qualifiedName)) {
      throw new Error(`Duplicate job: "${qualifiedName}" (registered by multiple features)`);
    }
    // runIn runtime-check. TS's JobRunIn = Exclude<RunIn, "both"> already
    // rejects "both" at compile time, but dynamically-constructed jobs
    // (serialized config, plugin authors using `as any`) could slip it
    // past the type system. Fail loud — "both" for jobs would mean "fan
    // out to both lane-queues", which over-delivers; the routing assumes
    // exactly one target queue per dispatch.
    // @cast-boundary schema-walk — defensive runtime-check against bypassed type-system
    const runIn = (jobDef as { runIn?: unknown }).runIn;
    if (runIn !== undefined && runIn !== "api" && runIn !== "worker") {
      throw new Error(
        `Invalid runIn "${String(runIn)}" on job "${qualifiedName}" — jobs must be pinned to a single lane ("api" or "worker"). "both" is not allowed because BullMQ queues are lane-scoped.`,
      );
    }
    state.jobMap.set(qualifiedName, { ...jobDef, name: qualifiedName });
  }

  // Notifications: scope:notify:name
  for (const [name, notifDef] of Object.entries(feature.notifications ?? {})) {
    const qualifiedName = qualify(feature.name, "notify", name);
    state.notificationMap.set(qualifiedName, {
      ...notifDef,
      name: qualifiedName,
      trigger: { on: notifDef.trigger.on },
    });
    state.notificationFeatureMap.set(qualifiedName, feature.name);
  }
}

// Events: scope:event:name. Upcaster chains stitched after full ingest (see validateEventUpcasters).
function populateEvents(state: RegistryState, feature: FeatureDefinition): void {
  // Events: scope:event:name. Migrations stay keyed by feature+short-name
  // in the FeatureDefinition and get stitched into the state.eventUpcasterMap
  // below (after ALL features are ingested) so cross-feature validation has
  // the complete picture.
  for (const [eventName, eventDef] of Object.entries(feature.events ?? {})) {
    const qualified = qualify(feature.name, "event", eventName);
    state.eventMap.set(qualified, { ...eventDef, name: qualified });
  }
}

// Translations prefixed with featureName: (i18next namespace convention).
function populateTranslations(state: RegistryState, feature: FeatureDefinition): void {
  // Translations prefixed with featureName: (i18next namespace convention)
  for (const [key, value] of Object.entries(feature.translations ?? {})) {
    state.mergedTranslations[`${feature.name}:${key}`] = value;
  }
}

// Lifecycle hooks (handler-targeted, qualified) + entity hooks (entity-targeted,
// unprefixed) + search-payload-extensions (additive per entity).
function populateHooks(state: RegistryState, feature: FeatureDefinition): void {
  // Lifecycle hooks: keyed by handler QN. featureName rides along on each
  // hook entry — defineFeature sets it, the registry just appends.
  // Save/delete hooks target write handlers, query hooks target query handlers.
  mergeHookListQualified(state.preSaveHooks, feature.hooks?.preSave, feature.name, "write");
  mergeHookListQualified(state.postSaveHooks, feature.hooks?.postSave, feature.name, "write");
  mergeHookListQualified(state.preDeleteHooks, feature.hooks?.preDelete, feature.name, "write");
  mergeHookListQualified(state.postDeleteHooks, feature.hooks?.postDelete, feature.name, "write");
  mergeHookListQualified(state.preQueryHooks, feature.hooks?.preQuery, feature.name, "query");
  mergeHookListQualified(state.postQueryHooks, feature.hooks?.postQuery, feature.name, "query");

  // Entity hooks: NOT prefixed, keyed by entity name
  mergeHookList(state.entityPostSaveHooks, feature.entityHooks?.postSave);
  mergeHookList(state.entityPreDeleteHooks, feature.entityHooks?.preDelete);
  mergeHookList(state.entityPostDeleteHooks, feature.entityHooks?.postDelete);
  mergeHookList(state.entityPostQueryHooks, feature.entityHooks?.postQuery);

  // F3 search-payload-extensions: per-entity contributors merged additively
  for (const [entityName, contributors] of Object.entries(feature.searchPayloadExtensions ?? {})) {
    const existing = state.searchPayloadExtensions.get(entityName) ?? [];
    for (const c of contributors) existing.push(c);
    state.searchPayloadExtensions.set(entityName, existing);
  }
}

// Registrar extension definitions + usages + selectors + reference-data + config-seeds.
function populateExtensionsAndSeeds(state: RegistryState, feature: FeatureDefinition): void {
  // Registrar extensions: collect definitions and usages
  for (const [extName, extDef] of Object.entries(feature.registrarExtensions ?? {})) {
    if (state.extensionMap.has(extName)) {
      throw new Error(
        `Duplicate registrar extension: "${extName}" (registered by multiple features)`,
      );
    }
    state.extensionMap.set(extName, extDef);
  }
  // Annotate the owner so consumers (readiness gating) can map a
  // registration back to the feature's config keys + secrets.
  state.extensionUsages.push(
    ...(feature.extensionUsages ?? []).map((u) => ({ ...u, featureName: feature.name })),
  );
  for (const sel of feature.extensionSelectors ?? []) {
    if (state.extensionSelectorMap.has(sel.extensionName)) {
      throw new Error(
        `Duplicate extension selector for "${sel.extensionName}" ` +
          `(feature "${feature.name}") — one owning feature declares the selector.`,
      );
    }
    state.extensionSelectorMap.set(sel.extensionName, sel.qualifiedKey);
  }
  state.allReferenceData.push(...(feature.referenceData ?? []));
  state.allConfigSeeds.push(...(feature.configSeeds ?? []));
}

// Metrics (name-validated, globally-unique) + secret keys (already qualified).
function populateMetricsAndSecrets(state: RegistryState, feature: FeatureDefinition): void {
  // Metrics: validate + qualify per feature. Collisions across features are
  // rejected here — two features can't both register "created_total" under
  // different shapes (labels/type) because the resulting fully qualified
  // names differ, but same short+feature combo would already fail in
  // defineFeature. This loop catches cross-feature/extension edge cases.
  for (const [shortName, def] of Object.entries(feature.metrics ?? {})) {
    const fullName = buildMetricName(feature.name, shortName);
    validateMetricName(fullName, def.type);
    if (state.metricMap.has(fullName)) {
      throw new Error(
        `[Kumiko Observability] Metric "${fullName}" registered multiple times ` +
          `(Feature: ${feature.name}). Metric names must be globally unique.`,
      );
    }
    state.metricMap.set(fullName, { ...def, featureName: feature.name });
  }

  // Secret keys: already qualified during defineFeature (same "<feature>:<short>"
  // convention used elsewhere). Reject cross-feature duplicates — extensions
  // could theoretically register on another feature's namespace.
  for (const def of Object.values(feature.secretKeys ?? {})) {
    if (state.secretKeyMap.has(def.qualifiedName)) {
      throw new Error(
        `[Kumiko Secrets] Secret key "${def.qualifiedName}" registered multiple times. ` +
          "Secret names must be globally unique across features.",
      );
    }
    state.secretKeyMap.set(def.qualifiedName, def);
  }
}

// Explicit + multi-stream projections (source-entity indexed) + raw tables +
// unmanaged tables (both cross-feature-uniqueness-by-physical-name guarded).
function populateProjectionsAndTables(state: RegistryState, feature: FeatureDefinition): void {
  // Projections: qualified by feature name. Build the source-entity index so
  // the event-store-executor can fetch matching projections in O(1) per write.
  for (const [projName, projDef] of Object.entries(feature.projections ?? {})) {
    const qualified = qualify(feature.name, "projection", projName);
    if (state.projectionMap.has(qualified)) {
      throw new Error(`Duplicate projection: "${qualified}" (registered by multiple features)`);
    }
    const stored = { ...projDef, name: qualified };
    state.projectionMap.set(qualified, stored);
    const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
    for (const src of sources) {
      const existing = state.projectionsBySource.get(src) ?? [];
      existing.push(stored);
      state.projectionsBySource.set(src, existing);
    }
  }

  // Multi-stream projections: qualified + stored for later wiring into
  // event-dispatcher. Namespace is shared with single-stream projections —
  // defineFeature already catches name collisions inside one feature, but
  // we also guard the cross-feature case here.
  for (const [mspName, mspDef] of Object.entries(feature.multiStreamProjections ?? {})) {
    const qualified = qualify(feature.name, "projection", mspName);
    if (state.projectionMap.has(qualified) || state.multiStreamProjectionMap.has(qualified)) {
      throw new Error(`Duplicate projection: "${qualified}" (registered by multiple features)`);
    }
    // runIn runtime-check. TS's RunIn union already enforces the three
    // values at compile time; this guards dynamically-constructed MSPs
    // (config-driven, plugin authors) that could slip a typo through.
    // @cast-boundary schema-walk — defensive runtime-check against bypassed type-system
    const mspRunIn = (mspDef as { runIn?: unknown }).runIn;
    if (
      mspRunIn !== undefined &&
      mspRunIn !== "api" &&
      mspRunIn !== "worker" &&
      mspRunIn !== "both"
    ) {
      throw new Error(
        `Invalid runIn "${String(mspRunIn)}" on MSP "${qualified}" — must be "api", "worker", or "both".`,
      );
    }
    state.multiStreamProjectionMap.set(qualified, { ...mspDef, name: qualified });
    state.multiStreamProjectionFeatureMap.set(qualified, feature.name);
  }

  // Raw tables: aggregated by feature-local short name (unprefixed —
  // these bypass the qualified-name namespace because they have no
  // event-stream binding to disambiguate). Reject cross-feature
  // duplicates at boot so the dev-server doesn't race two CREATE TABLE
  // statements that target the same physical table name.
  for (const [rawName, rawDef] of Object.entries(feature.rawTables ?? {})) {
    const existing = state.rawTableMap.get(rawName);
    if (existing) {
      throw new Error(
        `Raw-table "${rawName}" registered by both feature "${existing.featureName}" and ` +
          `"${feature.name}". Pick a feature-prefixed name to disambiguate.`,
      );
    }
    state.rawTableMap.set(rawName, { ...rawDef, featureName: feature.name });
  }

  // Unmanaged tables — same cross-feature uniqueness invariant as rawTables.
  // Two features registering the same physical tableName would race two
  // CREATE TABLE statements via migrate-runner.
  for (const [umName, umDef] of Object.entries(feature.unmanagedTables ?? {})) {
    const existing = state.unmanagedTableMap.get(umName);
    if (existing) {
      throw new Error(
        `Unmanaged-table "${umName}" registered by both feature "${existing.featureName}" and ` +
          `"${feature.name}". Pick a feature-prefixed tableName to disambiguate.`,
      );
    }
    const physicalClash = state.physicalTableOwners.get(umName);
    if (physicalClash?.kind === "entity") {
      throw new Error(
        `Unmanaged-table "${umName}" (feature "${feature.name}") collides with the physical ` +
          `table of entity "${physicalClash.owner}" (feature "${physicalClash.featureName}"). ` +
          `Pick a different tableName — both would emit CREATE TABLE "${umName}".`,
      );
    }
    const piiFields = umDef.meta.piiSubjectFields ?? [];
    if (piiFields.length > 0 && !umDef.piiEncryptedOnWrite) {
      throw new Error(
        `Unmanaged-table "${umName}" (feature "${feature.name}") has PII-annotated fields ` +
          `(${piiFields.join(", ")}) but direct writes bypass the executor's PII encryption. ` +
          `Encrypt those fields before every insert/update (encryptPiiFieldValues) and declare ` +
          `{ piiEncryptedOnWrite: true }, or drop the subject annotations.`,
      );
    }
    state.physicalTableOwners.set(umName, {
      kind: "unmanaged",
      owner: umName,
      featureName: feature.name,
    });
    state.unmanagedTableMap.set(umName, { ...umDef, featureName: feature.name });
  }
}

// Claim keys + auth-claims hooks (declaredShortNames threads the auto-prefix
// warning-set from claim-key declarations into the hooks registered right after —
// reordered next to each other; originally separated by the screens/nav/workspace
// block below, which has no dependency on either).
function populateClaimsAndAuth(state: RegistryState, feature: FeatureDefinition): void {
  // Claim keys: aggregated by qualified name. Two features cannot collide
  // here (qualified by feature name), but we still guard for explicit
  // correctness — the only way to hit this is a hand-built FeatureDefinition
  // bypassing defineFeature's per-feature duplicate check.
  const declaredShortNames = new Set<string>();
  for (const def of Object.values(feature.claimKeys ?? {})) {
    if (state.claimKeyMap.has(def.qualifiedName)) {
      throw new Error(
        `[Kumiko ClaimKeys] Claim key "${def.qualifiedName}" registered multiple times. ` +
          "Claim short-names must be globally unique across features.",
      );
    }
    state.claimKeyMap.set(def.qualifiedName, def);
    declaredShortNames.add(def.shortName);
  }
  // Auth-claims hooks: order of registration is preserved. Feature name is
  // captured alongside so the resolver can apply the auto-prefix at merge
  // time — the feature author never ships pre-prefixed keys.
  //
  // If the feature declared ANY claim keys, every hook from that feature
  // gets the declaredShortNames set attached. The resolver uses it to warn
  // on undeclared inner-keys (typo / rename drift). Features that don't
  // declare claimKeys skip the check entirely — it's opt-in.
  const declaredKeys = declaredShortNames.size > 0 ? declaredShortNames : undefined;
  for (const fn of feature.authClaimsHooks ?? []) {
    state.authClaimsHooks.push({
      featureName: feature.name,
      fn,
      ...(declaredKeys && { declaredKeys }),
    });
  }
}

// Screens + nav (qualified, entity/parent indexed) + workspaces (nav membership
// pass 1 — pass 2 folds self-assigned nav entries in after full ingest, see
// finalizeWorkspaceNavMembership) + tree-actions (at-most-one per feature).
function populateScreensNavWorkspaces(state: RegistryState, feature: FeatureDefinition): void {
  // Screens: qualified + stored. Uniqueness per-feature is enforced in
  // defineFeature; cross-feature collisions are impossible because the
  // qualified name includes the feature-prefix. The separate state.featureMap
  // entry lets the nav resolver pause screens owned by disabled features
  // in O(1) without walking every screen.
  for (const [screenId, screenDef] of Object.entries(feature.screens ?? {})) {
    const qualified = qualify(feature.name, "screen", screenId);
    // Stored version overwrites `id` with the qualified name so callers
    // never need a reverse index (NavDef → qn) during tree-walking.
    // Same pattern as state.writeHandlerMap/state.projectionMap/state.multiStreamProjectionMap
    // (see `{ ...def, name: qualified }` above). Feature-side
    // `feature.screens[shortId]` keeps the short id — only the registry
    // surface flips.
    const stored = { ...screenDef, id: qualified };
    state.screenMap.set(qualified, stored);
    state.screenFeatureMap.set(qualified, feature.name);
    // entity-Index nur für Screens die direkt an einer Entity hängen.
    // entityList/entityEdit haben `entity`; custom + actionForm haben
    // keinen entity-Bezug (custom ist opaque, actionForm hat inline
    // fields ohne Entity-Reference).
    if (stored.type === "entityList" || stored.type === "entityEdit") {
      const existing = state.screensByEntity.get(stored.entity) ?? [];
      existing.push(stored);
      state.screensByEntity.set(stored.entity, existing);
    }
  }

  // Nav entries: same qualification pattern as screens. The parent/screen
  // refs are boot-validated below (after all features are ingested, so
  // cross-feature parents can resolve). parent-index is built in the same
  // loop because `parent` refers to a qualified name that doesn't need
  // resolution — just string equality with whatever's in the target
  // entry's QN.
  for (const [navId, navDef] of Object.entries(feature.navs ?? {})) {
    const qualified = qualify(feature.name, "nav", navId);
    // See screens above — stored version carries the qualified id so
    // resolveNavigation can recurse via getNavsByParent(child.id) without
    // hand-building a reverse index.
    const stored = { ...navDef, id: qualified };
    state.navMap.set(qualified, stored);
    state.navFeatureMap.set(qualified, feature.name);
    if (stored.parent === undefined) {
      state.topLevelNavs.push(stored);
    } else {
      const existing = state.navsByParent.get(stored.parent) ?? [];
      existing.push(stored);
      state.navsByParent.set(stored.parent, existing);
    }
  }

  // Workspaces: same qualification pattern as nav/screen. Step one stores
  // the workspace itself + its explicit nav list; step two (after every
  // feature has been ingested) folds nav-self-assigned QNs into the same
  // member list. Doing it in two passes keeps cross-feature workspace
  // refs valid — a nav entry can self-assign to a workspace whose feature
  // hasn't been ingested yet.
  for (const [wsId, wsDef] of Object.entries(feature.workspaces ?? {})) {
    const qualified = qualify(feature.name, "workspace", wsId);
    const stored = { ...wsDef, id: qualified };
    state.workspaceMap.set(qualified, stored);
    state.workspaceFeatureMap.set(qualified, feature.name);
    // Seed the membership list with the workspace's explicit nav refs in
    // declaration order. Boot-validator checks the QNs resolve.
    state.navsByWorkspace.set(qualified, [...(stored.nav ?? [])]);
    if (stored.default === true) {
      // Boot-validator enforces uniqueness; here we just remember the
      // first one and let validateBoot complain if there's a second.
      if (state.defaultWorkspace === undefined) {
        state.defaultWorkspace = stored;
      }
    }
  }

  // Tree-Actions slot — at-most-one per feature (only-once-guard im
  // registrar). Erased Map für Runtime-Lookup; compile-time-typed
  // Surface läuft über FeatureDefinition.exports (TreeActionsHandle).
  if (feature.treeActions !== undefined) {
    state.treeActionsMap.set(feature.name, feature.treeActions);
  }
}

// Pass 2 for workspaces: fold any nav-self-assigned QNs into their
// workspace's member list. Safe now that every feature (and therefore every
// workspace) is in state.workspaceMap.
function finalizeWorkspaceNavMembership(state: RegistryState): void {
  // workspace's member list. We can do this safely now that every feature
  // (and therefore every workspace) is in state.workspaceMap. Cross-feature refs
  // — a nav from feature A self-assigning to a workspace from feature B —
  // resolve here because B's workspace was registered in pass 1 above.
  // Dedup: a nav entry that's also in r.workspace({ nav: [...] }) shouldn't
  // appear twice. Boot-validator catches dangling workspace ids.
  for (const [navQn, navDef] of state.navMap) {
    if (!navDef.workspaces || navDef.workspaces.length === 0) continue;
    for (const wsQn of navDef.workspaces) {
      const members = state.navsByWorkspace.get(wsQn);
      if (members === undefined) continue; // dangling — boot-validator reports
      if (!members.includes(navQn)) members.push(navQn);
    }
  }
}

// Build handler → entity mapping from feature declarations. Must happen before
// extension processing since extension preSave hooks need entity mappings.
function populateHandlerEntityMappings(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Build handler → entity mapping from feature declarations (filled by tryMapEntity
  // in defineFeature via the "entityName:verb" colon convention).
  // Must happen before extension processing since extension preSave hooks need entity mappings.
  for (const feature of features) {
    for (const [handlerName, entityName] of Object.entries(feature.handlerEntityMappings ?? {})) {
      const writeQn = qualify(feature.name, "write", handlerName);
      const queryQn = qualify(feature.name, "query", handlerName);
      if (state.writeHandlerMap.has(writeQn)) {
        state.handlerEntityMap.set(writeQn, entityName);
      }
      if (state.queryHandlerMap.has(queryQn)) {
        state.handlerEntityMap.set(queryQn, entityName);
      }
    }
  }
}

function validateExtensionSelectors(state: RegistryState): void {
  // Selector declarations point into the merged extension + config-key
  // sets — a typo'd extension or dropped key must fail the boot, not
  // silently un-gate readiness.
  for (const [extensionName, qualifiedKey] of state.extensionSelectorMap) {
    if (!state.extensionMap.has(extensionName)) {
      throw new Error(
        `extensionSelector("${extensionName}") declared but no feature ` +
          `registers that extension via extendsRegistrar.`,
      );
    }
    if (!state.configKeyMap.has(qualifiedKey)) {
      throw new Error(
        `extensionSelector("${extensionName}") points at unknown config key ` +
          `"${qualifiedKey}" — no mounted feature declares it.`,
      );
    }
  }
}

// Process extension usages: call onRegister, apply extendSchema, register hooks.
function applyExtensionUsages(state: RegistryState): void {
  // Process extension usages: call onRegister, apply extendSchema, register hooks
  for (const usage of state.extensionUsages) {
    const ext = state.extensionMap.get(usage.extensionName);
    if (!ext) continue;

    if (ext.onRegister) {
      ext.onRegister(usage.entityName, usage.options);
    }

    // extendSchema: merge extra fields into entity definition
    if (ext.extendSchema) {
      const entity = state.entityMap.get(usage.entityName);
      if (entity) {
        const extraFields = ext.extendSchema(usage.entityName);
        const merged = { ...entity, fields: { ...entity.fields, ...extraFields } };
        state.entityMap.set(usage.entityName, merged);
      }
    }

    // Extension hooks → entity hooks (fire for all writes on the entity).
    // Extensions default to afterCommit phase (same default as r.hook).
    //
    // Owner "*" = always-enabled, not gated by feature-toggles. Extensions
    // are plumbing (e.g. ownership) — the feature that declared them might
    // itself be toggleable, but the extension-hook is conceptually part of
    // the entity's invariants. If future requirements need extension hooks
    // to also be gated, store the registering-feature on
    // RegistrarExtensionRegistration and use that here.
    const extOwner = "*";
    if (ext.hooks) {
      if (ext.hooks.postSave) {
        const existing = state.entityPostSaveHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.postSave,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        state.entityPostSaveHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.preDelete) {
        const existing = state.entityPreDeleteHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.preDelete,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        state.entityPreDeleteHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.postDelete) {
        const existing = state.entityPostDeleteHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.postDelete,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        state.entityPostDeleteHooks.set(usage.entityName, existing);
      }
      // preSave on extensions: store as handler hook for all CRUD handlers of this entity
      if (ext.hooks.preSave) {
        // Find all write handlers that belong to this entity via state.handlerEntityMap
        for (const qualifiedHandler of state.writeHandlerMap.keys()) {
          if (state.handlerEntityMap.get(qualifiedHandler) === usage.entityName) {
            const existing = state.preSaveHooks.get(qualifiedHandler) ?? [];
            existing.push({ fn: ext.hooks.preSave, featureName: extOwner });
            state.preSaveHooks.set(qualifiedHandler, existing);
          }
        }
      }
    }
  }
}

// Precompute: searchable/sortable fields.
function buildSearchableSortableCaches(state: RegistryState): void {
  // Precompute: searchable/sortable fields, search includes, incoming relations

  for (const [name, entity] of state.entityMap) {
    const searchable: string[] = [];
    const sortable: string[] = [];
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type === "text" && field.searchable === true) searchable.push(fieldName);
      if (field.type === "text" && field.sortable === true) sortable.push(fieldName);
      if (field.type === "embedded") {
        for (const [subName, subField] of Object.entries(field.schema)) {
          if (subField.searchable === true) searchable.push(`${fieldName}_${subName}`);
        }
      }
    }
    state.searchableFieldsCache.set(name, searchable);
    state.sortableFieldsCache.set(name, sortable);
  }
}

// Implicit-Projection pro r.entity — see buildImplicitProjection doc above.
function buildImplicitProjections(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Implicit-Projection pro r.entity. Macht die Entity-Tabelle rebaubar
  // ohne dass Apps eine explizite r.projection schreiben müssen.
  // Naming-Convention: `<feature>:projection:<entityName>-entity` — der
  // "-entity"-Suffix unterscheidet implicit von explicit-Projections und
  // vermeidet Kollisionen wenn jemand z.B. eine Cross-Aggregate-Projection
  // mit Entity-Name registriert.
  for (const feature of features) {
    // extendEntityProjection targets must exist as r.entity in the SAME
    // feature — a typo'd entity name would otherwise vanish silently and the
    // extension's events would still be wiped on rebuild.
    for (const extEntity of Object.keys(feature.entityProjectionExtensions ?? {})) {
      if (!feature.entities?.[extEntity]) {
        throw new Error(
          `[Feature ${feature.name}] extendEntityProjection("${extEntity}"): no r.entity ` +
            `with that name in this feature. Declare the entity first — the extension ` +
            `merges into its implicit projection.`,
        );
      }
    }
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const def = buildImplicitProjection(
        feature.name,
        entityName,
        entity,
        qualify,
        feature.entityTables?.[entityName],
        feature.entityProjectionExtensions?.[entityName] ?? [],
      );
      if (state.projectionMap.has(def.name)) {
        throw new Error(
          `Implicit projection "${def.name}" kollidiert mit einer explizit registrierten r.projection. ` +
            `Implicit-Projections werden für jede r.entity mit "-entity"-Suffix angelegt — ` +
            `benenne deine explicit projection um (z.B. "<entity>-summary") um die Kollision aufzulösen.`,
        );
      }
      state.projectionMap.set(def.name, def);
      const existing = state.projectionsBySource.get(entityName) ?? [];
      existing.push(def);
      state.projectionsBySource.set(entityName, existing);
    }
  }
}

function validateNoRawTableProjectionClash(state: RegistryState): void {
  // Cross-cut: a r.rawTable() PgTable must not coincide with any
  // registered projection's table. Silent dedupe via Set would mask a
  // real authoring bug (two owners writing to the same physical table).
  // Run after both passes so implicit projections are visible too.
  const projectionTables = new Set<unknown>();
  for (const proj of state.projectionMap.values()) projectionTables.add(proj.table);
  for (const msp of state.multiStreamProjectionMap.values()) {
    if (msp.table) projectionTables.add(msp.table);
  }
  for (const raw of state.rawTableMap.values()) {
    if (projectionTables.has(raw.table)) {
      throw new Error(
        `r.rawTable "${raw.name}" (feature "${raw.featureName}") shares a Drizzle ` +
          `PgTable with a registered projection. Pick one owner: r.entity() / ` +
          `r.projection() for event-sourced reads, r.rawTable() for the bypass.`,
      );
    }
  }
}

function buildSearchIncludesAndIncomingRelations(state: RegistryState): void {
  for (const [entityName, rels] of state.relationMap) {
    const includes = new Map<string, readonly string[]>();
    for (const [relName, rel] of Object.entries(rels)) {
      if ((rel.type === "belongsTo" || rel.type === "manyToMany") && rel.searchInclude?.length) {
        includes.set(relName, rel.searchInclude);
      }
    }
    state.searchIncludesCache.set(entityName, includes);

    // Build reverse index for incoming relations
    for (const [relName, rel] of Object.entries(rels)) {
      const existing = state.incomingRelationsCache.get(rel.target) ?? [];
      existing.push({ sourceEntity: entityName, relationName: relName, relation: rel });
      state.incomingRelationsCache.set(rel.target, existing);
    }
  }
}

function validateFieldAccessHandlersAreEntityMapped(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Validate: handlers in features with field-access rules must be entity-mapped.
  // Without entity mapping, field-level access checks are silently skipped (security gap).
  for (const feature of features) {
    if (!hasFieldAccessRules(feature)) continue;

    for (const handlerName of Object.keys(feature.writeHandlers ?? {})) {
      const qualified = qualify(feature.name, "write", handlerName);
      if (!state.handlerEntityMap.has(qualified)) {
        throw new Error(
          `Write handler "${qualified}" is not mapped to any entity, but feature "${feature.name}" has field-level access rules. ` +
            `Name must follow "entity:verb" convention (e.g. "user:create") or use create/update/delete on a matching entity.`,
        );
      }
    }

    // Query handlers: only those with a colon must resolve (typo protection).
    for (const handlerName of Object.keys(feature.queryHandlers ?? {})) {
      if (!handlerName.includes(":")) continue;
      const qualified = qualify(feature.name, "query", handlerName);
      if (!state.handlerEntityMap.has(qualified)) {
        throw new Error(
          `Query handler "${qualified}" looks entity-bound but no matching entity exists. ` +
            `Either fix the entity name, or use a name without colons for standalone queries.`,
        );
      }
    }
  }
}

function validateRelationTargetsExist(state: RegistryState): void {
  // Validate: all relation targets must reference existing entities
  for (const [entityName, rels] of state.relationMap) {
    for (const [relName, rel] of Object.entries(rels)) {
      if (!state.entityMap.has(rel.target)) {
        throw new Error(
          `Relation "${entityName}.${relName}" targets entity "${rel.target}" which does not exist`,
        );
      }
    }
  }
}

function validateEventMigrationVersions(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Build + validate event upcaster chains. Run AFTER all features are
  // ingested so r.eventMigration calls can reference events from any
  // feature (same feature in practice, but the check stays lax for future
  // cross-feature event packs).
  for (const feature of features) {
    for (const [shortName, migrations] of Object.entries(feature.eventMigrations ?? {})) {
      const qualified = qualify(feature.name, "event", shortName);
      const eventDef = state.eventMap.get(qualified);
      if (!eventDef) {
        throw new Error(
          `Feature "${feature.name}" registered r.eventMigration for "${shortName}" ` +
            `but no r.defineEvent exists for that name. Register the event first.`,
        );
      }
      for (const m of migrations) {
        if (m.toVersion > eventDef.version) {
          throw new Error(
            `Feature "${feature.name}" has r.eventMigration("${shortName}", ${m.fromVersion}, ${m.toVersion}) ` +
              `but r.defineEvent declares only version ${eventDef.version}. ` +
              `Bump the version in defineEvent to at least ${m.toVersion}, or remove the migration.`,
          );
        }
      }
    }
  }
}

function buildEventUpcasterChains(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Stitch the upcaster chain per qualified event. At this point, gaps in
  // the chain (e.g. defineEvent version=3 but only a 1→2 migration exists)
  // are hard errors — they would silently hand a v2-shape payload to a
  // consumer expecting v3 at runtime, which is the class of bug upcasters
  // are supposed to prevent.
  for (const [qualified, eventDef] of state.eventMap) {
    const chainMap = new Map<number, EventUpcastFn>();
    // Locate the feature that owns this event (to pick up its migrations).
    for (const feature of features) {
      for (const [shortName, migs] of Object.entries(feature.eventMigrations ?? {})) {
        const candidateQn = qualify(feature.name, "event", shortName);
        if (candidateQn !== qualified) continue;
        for (const m of migs) chainMap.set(m.fromVersion, m.transform);
      }
    }
    if (eventDef.version > 1) {
      for (let v = 1; v < eventDef.version; v++) {
        if (!chainMap.has(v)) {
          throw new Error(
            `Event "${qualified}" declares version ${eventDef.version} but no migration ` +
              `covers the step v${v} → v${v + 1}. Register r.eventMigration("${qualified.split(":").pop() ?? qualified}", ${v}, ${v + 1}, transform) ` +
              `so stored v${v} payloads can be upcast on read.`,
          );
        }
      }
    }
    state.eventUpcasterMap.set(qualified, {
      currentVersion: eventDef.version,
      chain: chainMap,
    });
  }
}

function validateProjectionApplyKeys(state: RegistryState): void {
  // Validate: every projection's source must reference a registered entity.
  // A typo ("unti" instead of "unit") would otherwise be a silent no-op —
  // the projection is stored but never fires because no aggregateType ever
  // matches. Fail at boot so the feature author sees it immediately.
  //
  // Same guard extends to apply-keys: a handler for "unit.creatd" (missing
  // 'e') would silently never fire. Valid apply-keys are the auto-generated
  // CRUD types per source entity PLUS every domain event registered via
  // r.defineEvent — an apply-handler for a domain event is how a projection
  // reacts to ctx.appendEvent writes on the same aggregate stream.
  const AUTO_EVENT_VERBS = ["created", "updated", "deleted", "restored", "forgotten"] as const;
  const allDomainEventNames = new Set(state.eventMap.keys());
  for (const [projName, projDef] of state.projectionMap) {
    const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
    // extraSources (r.extendEntityProjection) sit in the rebuild filter, so
    // their auto-verbs are legitimately observable apply-keys too.
    const rebuildSources = [...sources, ...(projDef.extraSources ?? [])];
    const validEventTypes = new Set<string>();
    // Two source-modes are legal:
    //
    //  (a) Registered entity (r.entity(src, ...)) — the "normal" case:
    //      auto-lifecycle events `<src>.created/.updated/.deleted/.restored`
    //      fire when the event-store-executor writes, and any domain-event
    //      (r.defineEvent) appended onto an aggregate of that type is
    //      observable too.
    //
    //  (b) Events-only source — no r.entity registered, but at least one
    //      apply-key must be a domain-event (not a CRUD-verb on the source
    //      name). Use-case: features that own an append-only event-stream
    //      without a CRUD lifecycle, e.g. `deliveryAttempt` (each call to
    //      the delivery-service produces one event on a fresh aggregate)
    //      or `jobRun` (BullMQ-callback-driven lifecycle, no executor).
    //      A "Shape-Anchor"-entity is no longer needed for this case.
    const isEventsOnlySource = !sources.every((src) => state.entityMap.has(src));
    for (const src of rebuildSources) {
      if (state.entityMap.has(src)) {
        for (const verb of AUTO_EVENT_VERBS) validEventTypes.add(`${src}.${verb}`);
      }
    }
    // Domain events are valid apply-keys for any projection. They arrive via
    // ctx.appendEvent on a specific aggregate — the runtime matches by event
    // type, so a projection can observe domain events whose aggregate matches
    // one of its declared sources.
    for (const domainEvt of allDomainEventNames) validEventTypes.add(domainEvt);

    // In events-only mode, at least one apply-key MUST be a domain-event —
    // otherwise the source is simply a typo (no events will ever fire).
    if (isEventsOnlySource) {
      const hasAnyDomainEvent = Object.keys(projDef.apply).some((k) => allDomainEventNames.has(k));
      if (!hasAnyDomainEvent) {
        const unregistered = sources.filter((src) => !state.entityMap.has(src));
        throw new Error(
          `Projection "${projName}" declares source(s) [${unregistered.join(", ")}] that are not registered entities, ` +
            `and has no domain-event apply-keys. This is either a typo or a missing r.defineEvent registration. ` +
            `Events-only projections need at least one apply-key from r.defineEvent; ` +
            `CRUD-style projections need r.entity("${unregistered[0]}", ...).`,
        );
      }
    }

    for (const applyKey of Object.keys(projDef.apply)) {
      if (!validEventTypes.has(applyKey)) {
        throw new Error(
          `Projection "${projName}" has an apply handler for "${applyKey}" but no such event ` +
            `type exists for its source(s) [${sources.join(", ")}]. ` +
            `Valid types: ${[...validEventTypes].join(", ")}. ` +
            `Check for a typo — auto-verbs follow "<entity>.<verb>"; ` +
            `domain events follow "<feature>:event:<short-name>" (see r.defineEvent).`,
        );
      }
    }
  }
}

function validateRequiredFeatures(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Validate: all required features must be registered
  for (const feature of features) {
    for (const required of feature.requires ?? []) {
      if (!state.featureMap.has(required)) {
        throw new Error(
          `Feature "${feature.name}" requires feature "${required}" which is not registered`,
        );
      }
    }
  }
}

function resolveNotificationTriggersAndRegisterHooks(state: RegistryState): void {
  // Resolve notification triggers and register postSave hooks
  // Done after all features are registered so cross-feature triggers work
  const allHandlerNames = new Set([
    ...state.writeHandlerMap.keys(),
    ...state.queryHandlerMap.keys(),
  ]);
  for (const [qualifiedName, notifDef] of state.notificationMap) {
    // Both maps are populated in lockstep — same key-set by construction.
    const featureName = state.notificationFeatureMap.get(qualifiedName) as string; // @cast-boundary engine-bridge
    // I'll try the easy path first: if the trigger is already a fully qualified QN
    // (cross-feature), I take it as-is. Otherwise I qualify with the own feature —
    // as a write handler first (the common case), then as a query. If nothing
    // matches by then, it was a typo and I'll say so.
    let triggerOn: string;
    if (allHandlerNames.has(notifDef.trigger.on)) {
      triggerOn = notifDef.trigger.on;
    } else {
      // Try as write handler first (most common), then query
      const writeQn = qualify(featureName, "write", notifDef.trigger.on);
      const queryQn = qualify(featureName, "query", notifDef.trigger.on);
      if (allHandlerNames.has(writeQn)) {
        triggerOn = writeQn;
      } else if (allHandlerNames.has(queryQn)) {
        triggerOn = queryQn;
      } else {
        throw new Error(
          `Notification "${qualifiedName}" triggers on "${notifDef.trigger.on}" ` +
            `but no handler with that name exists. ` +
            `Tried: "${notifDef.trigger.on}", "${writeQn}", and "${queryQn}"`,
        );
      }
    }
    // Update the stored definition with resolved trigger
    state.notificationMap.set(qualifiedName, { ...notifDef, trigger: { on: triggerOn } });

    if (!state.postSaveHooks.has(triggerOn)) state.postSaveHooks.set(triggerOn, []);
    state.postSaveHooks.get(triggerOn)?.push({
      phase: HookPhases.afterCommit,
      featureName,
      fn: async (result, context) => {
        if (!context.notify) {
          context.log?.debug(
            `notification ${qualifiedName}: skipping — no notify function configured on context`,
          );
          return;
        }
        const to = notifDef.recipient(result);
        if (to === null) {
          context.log?.debug(
            `notification ${qualifiedName}: skipping — recipient resolver returned null for result ${result.id}`,
          );
          return;
        }
        const data = notifDef.data(result);
        await context.notify(qualifiedName, { to, data });
      },
    });
  }
}

function validateLifecycleHookTargets(state: RegistryState): void {
  // Validate: lifecycle hook targets must reference existing handlers
  const allHandlers = new Set([...state.writeHandlerMap.keys(), ...state.queryHandlerMap.keys()]);
  const lifecycleHookMaps = [
    { map: state.preSaveHooks, phase: "preSave" },
    { map: state.postSaveHooks, phase: "postSave" },
    { map: state.preDeleteHooks, phase: "preDelete" },
    { map: state.postDeleteHooks, phase: "postDelete" },
    { map: state.preQueryHooks, phase: "preQuery" },
    { map: state.postQueryHooks, phase: "postQuery" },
  ] as const;

  // I'd rather warn you now at boot than have you open a ticket three weeks from now
  // saying "my hook isn't firing". One typo in the target and the thing goes silent.
  for (const { map, phase } of lifecycleHookMaps) {
    for (const hookTarget of map.keys()) {
      if (!allHandlers.has(hookTarget)) {
        throw new Error(
          `${phase} hook targets "${hookTarget}" but no handler with that name exists. ` +
            `Check for typos — the hook will never fire.`,
        );
      }
    }
  }
}

function validateEntityHookTargets(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Same logic for entity-keyed hooks — targets must reference existing entities.
  // Memory `feedback_dead_hook_needs_second_consumer`: a typo silently registers
  // and never fires. Validates all four entity-hook types (postSave/preDelete/
  // postDelete/postQuery) — net cleanup of an existing antipattern, not a
  // postQuery-special.
  const allEntities = new Set<string>();
  for (const feature of features) {
    for (const entityName of Object.keys(feature.entities ?? {})) {
      allEntities.add(entityName);
    }
  }
  const entityHookMaps = [
    { map: state.entityPostSaveHooks, phase: "postSave (entityHook)", kind: "hook" },
    { map: state.entityPreDeleteHooks, phase: "preDelete (entityHook)", kind: "hook" },
    { map: state.entityPostDeleteHooks, phase: "postDelete (entityHook)", kind: "hook" },
    { map: state.entityPostQueryHooks, phase: "postQuery (entityHook)", kind: "hook" },
    { map: state.searchPayloadExtensions, phase: "searchPayloadExtension", kind: "extension" },
  ] as const;
  for (const { map, phase, kind } of entityHookMaps) {
    for (const entityName of map.keys()) {
      if (!allEntities.has(entityName)) {
        throw new Error(
          `${phase} ${kind} targets entity "${entityName}" but no entity with that name exists. ` +
            `Check for typos — the ${kind} will never fire.`,
        );
      }
    }
  }
}

function validateJobTriggers(state: RegistryState): void {
  // Validate: job event triggers must reference existing handlers.
  // Multi-Trigger-Form: jeden Eintrag im Array gegen allHandlers prüfen,
  // auch wenn nur einer fehlt fail-fast.
  const allHandlers = new Set([...state.writeHandlerMap.keys(), ...state.queryHandlerMap.keys()]);
  for (const [jobName, jobDef] of state.jobMap) {
    if (!("on" in jobDef.trigger)) continue;
    const triggerOn = jobDef.trigger.on;
    const triggers = Array.isArray(triggerOn) ? triggerOn : [triggerOn];
    for (const t of triggers) {
      const rawName = resolveName(t);
      if (allHandlers.has(rawName)) continue;
      throw new Error(
        `Job "${jobName}" triggers on "${rawName}" but no handler with that name exists`,
      );
    }
  }
}

function validateExtensionUsageTargets(state: RegistryState): void {
  // Validate: extension usages must reference existing extensions
  for (const usage of state.extensionUsages) {
    if (!state.extensionMap.has(usage.extensionName)) {
      throw new Error(
        `Extension usage "${usage.extensionName}" on entity "${usage.entityName}" references an extension that does not exist`,
      );
    }
  }
}

// Pre-compute: any handler with a rateLimit option?
function computeHasRateLimitedHandler(state: RegistryState): void {
  // Pre-compute: any handler with a rateLimit option? Keeps the boot
  // path able to short-circuit the RateLimitResolver wiring (and its
  // Lua-script registration on Redis) when nobody opted in.
  state.hasRateLimitedHandlerCached = (() => {
    for (const h of state.writeHandlerMap.values()) if (h.rateLimit !== undefined) return true;
    for (const h of state.queryHandlerMap.values()) if (h.rateLimit !== undefined) return true;
    return false;
  })();
}

function publishEventPiiCatalog(state: RegistryState): void {
  // Publish the event-PII catalog (#799): append() — the single write funnel
  // into kumiko_events — encrypts catalogued payload fields regardless of
  // which path produced the event (ctx.appendEvent, MSP-apply, low-level
  // append in delivery/jobs loggers).
  const eventPiiCatalog = new Map<string, EventPiiFields>();
  for (const [qualified, def] of state.eventMap) {
    if (def.piiFields) eventPiiCatalog.set(qualified, def.piiFields);
  }
  configureEventPiiCatalog(eventPiiCatalog);
}

function autoWireSoftDeleteJobs(state: RegistryState): void {
  // Auto-wire the soft-delete cleanup cron + its grace-days config key when ANY
  // entity opts into softDelete — the framework owns this machinery, no feature
  // declares it (mirrors the auto restore-handler). Job-runner reads getAllJobs
  // ungated; config-resolver reads getConfigKey → default. Reserved owner
  // segment, guarded against a real-feature collision.
  if ([...state.entityMap.values()].some((e) => e.softDelete)) {
    if (!state.jobMap.has(SOFT_DELETE_CLEANUP_JOB)) {
      state.jobMap.set(SOFT_DELETE_CLEANUP_JOB, buildSoftDeleteCleanupJob());
    }
    if (!state.jobMap.has(SOFT_DELETE_CLEANUP_SYSTEM_JOB)) {
      state.jobMap.set(SOFT_DELETE_CLEANUP_SYSTEM_JOB, buildSoftDeleteCleanupSystemJob());
    }
    if (!state.configKeyMap.has(SOFT_DELETE_GRACE_DAYS_KEY)) {
      state.configKeyMap.set(SOFT_DELETE_GRACE_DAYS_KEY, softDeleteGraceDaysConfig);
    }
  }
}

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

/** Returns true if any entity in the feature has field-level access rules (read or write). */
function hasFieldAccessRules(feature: FeatureDefinition): boolean {
  for (const entity of Object.values(feature.entities ?? {})) {
    for (const field of Object.values(entity.fields)) {
      if (field.access?.read?.length || field.access?.write?.length) {
        return true;
      }
    }
  }
  return false;
}
