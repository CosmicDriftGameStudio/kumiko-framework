import { applyEntityEvent } from "../db/apply-entity-event";
import { buildEntityTable } from "../db/table-builder";
import { buildMetricName, validateMetricName } from "../observability";
import { type QnType, qualifyEntityName } from "./qualified-name";
import type {
  AuthClaimsHookDef,
  ClaimKeyDefinition,
  ConfigKeyDefinition,
  ConfigSeedDef,
  EntityDefinition,
  EntityRelations,
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
  TreeChildrenSubscribe,
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
): ProjectionDefinition {
  const name = qualify(featureName, "projection", `${entityName}${IMPLICIT_PROJECTION_SUFFIX}`);
  const drizzleTable = buildEntityTable(entityName, entity);
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
  };
  // Restore-Verb existiert nur für softDelete-Entities. Hard-Delete-
  // Entities sollten keine restored-Events produzieren — würden sie es
  // doch, würde applyEntityEvent intern als no-op laufen, aber wir
  // registrieren den Handler gar nicht erst.
  if (entity.softDelete) {
    apply[`${entityName}.restored`] = handler;
  }
  return {
    name,
    source: entityName,
    table: drizzleTable,
    apply,
    isImplicit: true,
  };
}

// This is where the magic happens. By "magic" I mean: precomputed maps.
// I build everything once at boot (hooks, relations, searchable fields, ...)
// so nothing has to iterate over objects at runtime. O(1) instead of O(n*m).
export function createRegistry(features: readonly FeatureDefinition[]): Registry {
  const featureMap = new Map<string, FeatureDefinition>();
  const entityMap = new Map<string, EntityDefinition>();
  const relationMap = new Map<string, Record<string, RelationDefinition>>();
  const writeHandlerMap = new Map<string, WriteHandlerDef>();
  const queryHandlerMap = new Map<string, QueryHandlerDef>();
  // Hook storage. Every entry carries its owning feature (on the OwnedFn /
  // PhasedHook shape), so the lifecycle pipeline can skip hooks whose
  // feature is globally disabled without a parallel bookkeeping map.
  // featureName === "*" = always fire (extension-provided invariants).
  const preSaveHooks = new Map<string, OwnedFn<PreSaveHookFn>[]>();
  const postSaveHooks = new Map<string, PhasedHook<PostSaveHookFn>[]>();
  const preDeleteHooks = new Map<string, PhasedHook<PreDeleteHookFn>[]>();
  const postDeleteHooks = new Map<string, PhasedHook<PostDeleteHookFn>[]>();
  const preQueryHooks = new Map<string, OwnedFn<PreQueryHookFn>[]>();
  const postQueryHooks = new Map<string, OwnedFn<PostQueryHookFn>[]>();
  // Entity hooks — keyed by entity name, NOT prefixed
  const entityPostSaveHooks = new Map<string, PhasedHook<PostSaveHookFn>[]>();
  const entityPreDeleteHooks = new Map<string, PhasedHook<PreDeleteHookFn>[]>();
  const entityPostDeleteHooks = new Map<string, PhasedHook<PostDeleteHookFn>[]>();
  const entityPostQueryHooks = new Map<string, OwnedFn<PostQueryHookFn>[]>();
  const searchPayloadExtensions = new Map<string, OwnedFn<SearchPayloadContributorFn>[]>();
  const configKeyMap = new Map<string, ConfigKeyDefinition>();
  const jobMap = new Map<string, JobDefinition>();
  const notificationMap = new Map<string, NotificationDefinition>();
  const notificationFeatureMap = new Map<string, string>(); // qualifiedName → featureName
  const eventMap = new Map<string, EventDef>();
  // Schema-migration chain per qualified event name. Built at boot after all
  // features are ingested, then exposed via getEventUpcasters(). Readers of
  // the events-table (projection rebuild, future aggregate loaders) walk the
  // chain to upcast stored payloads to the current shape at read time.
  const eventUpcasterMap = new Map<
    string,
    { readonly currentVersion: number; readonly chain: ReadonlyMap<number, EventUpcastFn> }
  >();
  // Handler → entity mapping (populated from entities + handler name convention)
  const handlerEntityMap = new Map<string, string>();
  // Handler → feature mapping (for systemScope check)
  const handlerFeatureMap = new Map<string, string>();
  const extensionMap = new Map<string, RegistrarExtensionDef>();
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  const allReferenceData: ReferenceDataDef[] = [];
  const allConfigSeeds: ConfigSeedDef[] = [];
  const mergedTranslations: Record<string, Record<string, string>> = {};
  // Metric registry — keyed by fully qualified name (kumiko_<feature>_<short>).
  // Boot-time validation rejects bad names; dashboards then safely rely on shape.
  const metricMap = new Map<string, FeatureMetricDef & { readonly featureName: string }>();
  // Feature-declared secrets. Keyed by qualified name ("<feature>:<short>").
  // The map is the source of truth for ops-UIs, the rotation job, and any
  // boot validation that wants to reject a secrets.get for an unknown key.
  const secretKeyMap = new Map<string, SecretKeyDefinition>();
  // Projections — full list keyed by qualified name AND a source-entity index
  // the executor consults on every write. Index is precomputed so the hot path
  // does a single Map.get, never a scan.
  const projectionMap = new Map<string, ProjectionDefinition>();
  const projectionsBySource = new Map<string, ProjectionDefinition[]>();
  // Multi-stream projections — cross-aggregate, async via event-dispatcher.
  // One qualified name per MSP; each becomes its own EventConsumer with a
  // dedicated cursor in kumiko_event_consumers.
  const multiStreamProjectionMap = new Map<string, MultiStreamProjectionDefinition>();
  // qualified-MSP-name → owning-feature name. Used by the event-dispatcher
  // to pause consumers whose feature is globally disabled.
  const multiStreamProjectionFeatureMap = new Map<string, string>();
  // Raw tables — declared via r.rawTable(). Bypass the projection registry,
  // so they have no qualified-name namespace and no source-entity index.
  // Keyed by the feature-local short name; cross-feature uniqueness is
  // enforced at ingest below (collisions would race two CREATE TABLE
  // statements at the same physical name and break boot).
  const rawTableMap = new Map<string, RawTableDef>();
  // Unmanaged tables — declared via r.unmanagedTable() (EntityTableMeta).
  // Cousin of rawTables: same uniqueness-by-tableName invariant, different
  // storage shape (post-drizzle migrate-runner consumes EntityTableMeta).
  const unmanagedTableMap = new Map<string, UnmanagedTableDef>();
  // Auth-claims hooks — tagged with featureName so the login resolver can
  // auto-prefix each hook's returned keys with "<feature>:".
  const authClaimsHooks: AuthClaimsHookDef[] = [];
  // Feature-declared claim keys. Keyed by qualified name ("<feature>:<short>").
  // Used by readClaim callers to introspect; the resolver reads it via the
  // declaredKeys set on each AuthClaimsHookDef (pre-built per feature below).
  const claimKeyMap = new Map<string, ClaimKeyDefinition>();
  // Screens — keyed by qualified name ("<feature>:screen:<id>"). One map for
  // lookup + a parallel featureMap so the nav-resolver can gate screens by
  // effective-features without scanning. `screensByEntity` pre-groups the
  // entity-bound screens (entityList / entityEdit) by their entity name so
  // ui-core's Schema-driven view-model builders don't need to scan
  // getAllScreens() for every render.
  const screenMap = new Map<string, ScreenDefinition>();
  const screenFeatureMap = new Map<string, string>();
  const screensByEntity = new Map<string, ScreenDefinition[]>();
  // Nav entries — same shape as screenMap. Tree assembly happens in ui-core
  // at render time; the engine just stores the flat list and its owners.
  // `navsByParent` pre-groups children by their parent's QN so
  // resolveNavigation does O(n) passes, not O(n²) parent-filters. Top-level
  // entries (no parent) sit in the separate `topLevelNavs` list.
  const navMap = new Map<string, NavDefinition>();
  const navFeatureMap = new Map<string, string>();
  const navsByParent = new Map<string, NavDefinition[]>();
  const topLevelNavs: NavDefinition[] = [];

  // Workspaces — stored verbatim, plus a parallel feature-owner map and a
  // pre-computed nav-membership map. Membership merges two sources at boot:
  //   1. r.workspace({ nav: [...] }) — explicit list on the workspace
  //   2. r.nav({ workspaces: [...] }) — self-assignment on the nav entry
  // Order matters for the switcher: workspace-declared QNs come first (in
  // declaration order), then nav-self-assigned ones (in registration order).
  // Duplicates are deduped — a nav entry listed in both shows up once.
  const workspaceMap = new Map<string, WorkspaceDefinition>();
  const workspaceFeatureMap = new Map<string, string>();
  const navsByWorkspace = new Map<string, string[]>();
  let defaultWorkspace: WorkspaceDefinition | undefined;

  // Visual-Tree-Provider — keyed by declaring feature name (NOT qualified;
  // ein Feature liefert genau einen Provider). Visual-Tree-Component
  // iteriert die Map zur Mount-Zeit. Tree-Actions parallel — featureName
  // → erased Action-Map (compile-time-typed Variante geht über
  // setup-export-handle, siehe FeatureRegistrar.treeActions docs).
  const treeProvidersMap = new Map<string, TreeChildrenSubscribe>();
  const treeActionsMap = new Map<string, Readonly<Record<string, TreeActionDef>>>();

  // Local alias for readability — `qualifyEntityName` is the shared helper
  // from qualified-name.ts, also used by validateBoot to keep ingest and
  // validation in lockstep on the qualification rule.
  const qualify = qualifyEntityName;

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
    // skip: optionaler hook-slot — defineFeature lässt das slot undefined
    // wenn das feature keine hooks dieses typs hat. Behandeln wie leeres
    // record statt Object.entries(undefined)-crash.
    if (!source) return;
    for (const [name, fns] of Object.entries(source)) {
      const qualified = qualify(featureName, hookQnType, name);
      const existing = map.get(qualified) ?? [];
      existing.push(...fns);
      map.set(qualified, existing);
    }
  }

  for (const feature of features) {
    if (featureMap.has(feature.name)) {
      throw new Error(`Duplicate feature: "${feature.name}"`);
    }
    featureMap.set(feature.name, feature);

    // Entities: NOT prefixed — entity names must be globally unique
    for (const [name, entity] of Object.entries(feature.entities ?? {})) {
      if (entityMap.has(name)) {
        throw new Error(`Duplicate entity: "${name}" (registered by multiple features)`);
      }
      entityMap.set(name, entity);
    }

    // Relations: entityName (not prefixed)
    for (const [entityName, rels] of Object.entries(feature.relations ?? {})) {
      const existing = relationMap.get(entityName) ?? {};
      for (const [relName, relDef] of Object.entries(rels)) {
        if (existing[relName]) {
          throw new Error(
            `Duplicate relation: "${entityName}.${relName}" (registered by multiple features)`,
          );
        }
        existing[relName] = relDef;
      }
      relationMap.set(entityName, existing);
    }

    // Write handlers: scope:write:name
    for (const [name, handler] of Object.entries(feature.writeHandlers ?? {})) {
      const qualified = qualify(feature.name, "write", name);
      if (writeHandlerMap.has(qualified)) {
        throw new Error(
          `Duplicate write handler: "${qualified}" (registered by multiple features)`,
        );
      }
      writeHandlerMap.set(qualified, { ...handler, name: qualified });
      handlerFeatureMap.set(qualified, feature.name);
    }

    // Query handlers: scope:query:name
    for (const [name, handler] of Object.entries(feature.queryHandlers ?? {})) {
      const qualified = qualify(feature.name, "query", name);
      if (queryHandlerMap.has(qualified)) {
        throw new Error(
          `Duplicate query handler: "${qualified}" (registered by multiple features)`,
        );
      }
      queryHandlerMap.set(qualified, { ...handler, name: qualified });
      handlerFeatureMap.set(qualified, feature.name);
    }

    // Config keys: scope:config:name
    for (const [key, keyDef] of Object.entries(feature.configKeys ?? {})) {
      const qualifiedKey = qualify(feature.name, "config", key);
      if (configKeyMap.has(qualifiedKey)) {
        throw new Error(
          `Duplicate config key: "${qualifiedKey}" (registered by multiple features)`,
        );
      }
      configKeyMap.set(qualifiedKey, keyDef);
    }

    // Jobs: scope:job:name
    for (const [name, jobDef] of Object.entries(feature.jobs ?? {})) {
      const qualifiedName = qualify(feature.name, "job", name);
      if (jobMap.has(qualifiedName)) {
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
      jobMap.set(qualifiedName, { ...jobDef, name: qualifiedName });
    }

    // Notifications: scope:notify:name
    for (const [name, notifDef] of Object.entries(feature.notifications ?? {})) {
      const qualifiedName = qualify(feature.name, "notify", name);
      notificationMap.set(qualifiedName, {
        ...notifDef,
        name: qualifiedName,
        trigger: { on: notifDef.trigger.on },
      });
      notificationFeatureMap.set(qualifiedName, feature.name);
    }

    // Events: scope:event:name. Migrations stay keyed by feature+short-name
    // in the FeatureDefinition and get stitched into the eventUpcasterMap
    // below (after ALL features are ingested) so cross-feature validation has
    // the complete picture.
    for (const [eventName, eventDef] of Object.entries(feature.events ?? {})) {
      const qualified = qualify(feature.name, "event", eventName);
      eventMap.set(qualified, { ...eventDef, name: qualified });
    }

    // Translations prefixed with featureName: (i18next namespace convention)
    for (const [key, value] of Object.entries(feature.translations ?? {})) {
      mergedTranslations[`${feature.name}:${key}`] = value;
    }

    // Lifecycle hooks: keyed by handler QN. featureName rides along on each
    // hook entry — defineFeature sets it, the registry just appends.
    // Save/delete hooks target write handlers, query hooks target query handlers.
    mergeHookListQualified(preSaveHooks, feature.hooks?.preSave, feature.name, "write");
    mergeHookListQualified(postSaveHooks, feature.hooks?.postSave, feature.name, "write");
    mergeHookListQualified(preDeleteHooks, feature.hooks?.preDelete, feature.name, "write");
    mergeHookListQualified(postDeleteHooks, feature.hooks?.postDelete, feature.name, "write");
    mergeHookListQualified(preQueryHooks, feature.hooks?.preQuery, feature.name, "query");
    mergeHookListQualified(postQueryHooks, feature.hooks?.postQuery, feature.name, "query");

    // Entity hooks: NOT prefixed, keyed by entity name
    mergeHookList(entityPostSaveHooks, feature.entityHooks?.postSave);
    mergeHookList(entityPreDeleteHooks, feature.entityHooks?.preDelete);
    mergeHookList(entityPostDeleteHooks, feature.entityHooks?.postDelete);
    mergeHookList(entityPostQueryHooks, feature.entityHooks?.postQuery);

    // F3 search-payload-extensions: per-entity contributors merged additively
    for (const [entityName, contributors] of Object.entries(
      feature.searchPayloadExtensions ?? {},
    )) {
      const existing = searchPayloadExtensions.get(entityName) ?? [];
      for (const c of contributors) existing.push(c);
      searchPayloadExtensions.set(entityName, existing);
    }

    // Registrar extensions: collect definitions and usages
    for (const [extName, extDef] of Object.entries(feature.registrarExtensions ?? {})) {
      if (extensionMap.has(extName)) {
        throw new Error(
          `Duplicate registrar extension: "${extName}" (registered by multiple features)`,
        );
      }
      extensionMap.set(extName, extDef);
    }
    extensionUsages.push(...(feature.extensionUsages ?? []));
    allReferenceData.push(...(feature.referenceData ?? []));
    allConfigSeeds.push(...(feature.configSeeds ?? []));

    // Metrics: validate + qualify per feature. Collisions across features are
    // rejected here — two features can't both register "created_total" under
    // different shapes (labels/type) because the resulting fully qualified
    // names differ, but same short+feature combo would already fail in
    // defineFeature. This loop catches cross-feature/extension edge cases.
    for (const [shortName, def] of Object.entries(feature.metrics ?? {})) {
      const fullName = buildMetricName(feature.name, shortName);
      validateMetricName(fullName, def.type);
      if (metricMap.has(fullName)) {
        throw new Error(
          `[Kumiko Observability] Metric "${fullName}" registered multiple times ` +
            `(Feature: ${feature.name}). Metric names must be globally unique.`,
        );
      }
      metricMap.set(fullName, { ...def, featureName: feature.name });
    }

    // Secret keys: already qualified during defineFeature (same "<feature>:<short>"
    // convention used elsewhere). Reject cross-feature duplicates — extensions
    // could theoretically register on another feature's namespace.
    for (const def of Object.values(feature.secretKeys ?? {})) {
      if (secretKeyMap.has(def.qualifiedName)) {
        throw new Error(
          `[Kumiko Secrets] Secret key "${def.qualifiedName}" registered multiple times. ` +
            "Secret names must be globally unique across features.",
        );
      }
      secretKeyMap.set(def.qualifiedName, def);
    }

    // Projections: qualified by feature name. Build the source-entity index so
    // the event-store-executor can fetch matching projections in O(1) per write.
    for (const [projName, projDef] of Object.entries(feature.projections ?? {})) {
      const qualified = qualify(feature.name, "projection", projName);
      if (projectionMap.has(qualified)) {
        throw new Error(`Duplicate projection: "${qualified}" (registered by multiple features)`);
      }
      const stored = { ...projDef, name: qualified };
      projectionMap.set(qualified, stored);
      const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
      for (const src of sources) {
        const existing = projectionsBySource.get(src) ?? [];
        existing.push(stored);
        projectionsBySource.set(src, existing);
      }
    }

    // Multi-stream projections: qualified + stored for later wiring into
    // event-dispatcher. Namespace is shared with single-stream projections —
    // defineFeature already catches name collisions inside one feature, but
    // we also guard the cross-feature case here.
    for (const [mspName, mspDef] of Object.entries(feature.multiStreamProjections ?? {})) {
      const qualified = qualify(feature.name, "projection", mspName);
      if (projectionMap.has(qualified) || multiStreamProjectionMap.has(qualified)) {
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
      multiStreamProjectionMap.set(qualified, { ...mspDef, name: qualified });
      multiStreamProjectionFeatureMap.set(qualified, feature.name);
    }

    // Raw tables: aggregated by feature-local short name (unprefixed —
    // these bypass the qualified-name namespace because they have no
    // event-stream binding to disambiguate). Reject cross-feature
    // duplicates at boot so the dev-server doesn't race two CREATE TABLE
    // statements that target the same physical table name.
    for (const [rawName, rawDef] of Object.entries(feature.rawTables ?? {})) {
      const existing = rawTableMap.get(rawName);
      if (existing) {
        throw new Error(
          `Raw-table "${rawName}" registered by both feature "${existing.featureName}" and ` +
            `"${feature.name}". Pick a feature-prefixed name to disambiguate.`,
        );
      }
      rawTableMap.set(rawName, { ...rawDef, featureName: feature.name });
    }

    // Unmanaged tables — same cross-feature uniqueness invariant as rawTables.
    // Two features registering the same physical tableName would race two
    // CREATE TABLE statements via migrate-runner.
    for (const [umName, umDef] of Object.entries(feature.unmanagedTables ?? {})) {
      const existing = unmanagedTableMap.get(umName);
      if (existing) {
        throw new Error(
          `Unmanaged-table "${umName}" registered by both feature "${existing.featureName}" and ` +
            `"${feature.name}". Pick a feature-prefixed tableName to disambiguate.`,
        );
      }
      unmanagedTableMap.set(umName, { ...umDef, featureName: feature.name });
    }

    // Claim keys: aggregated by qualified name. Two features cannot collide
    // here (qualified by feature name), but we still guard for explicit
    // correctness — the only way to hit this is a hand-built FeatureDefinition
    // bypassing defineFeature's per-feature duplicate check.
    const declaredShortNames = new Set<string>();
    for (const def of Object.values(feature.claimKeys ?? {})) {
      if (claimKeyMap.has(def.qualifiedName)) {
        throw new Error(
          `[Kumiko ClaimKeys] Claim key "${def.qualifiedName}" registered multiple times. ` +
            "Claim short-names must be globally unique across features.",
        );
      }
      claimKeyMap.set(def.qualifiedName, def);
      declaredShortNames.add(def.shortName);
    }

    // Screens: qualified + stored. Uniqueness per-feature is enforced in
    // defineFeature; cross-feature collisions are impossible because the
    // qualified name includes the feature-prefix. The separate featureMap
    // entry lets the nav resolver pause screens owned by disabled features
    // in O(1) without walking every screen.
    for (const [screenId, screenDef] of Object.entries(feature.screens ?? {})) {
      const qualified = qualify(feature.name, "screen", screenId);
      // Stored version overwrites `id` with the qualified name so callers
      // never need a reverse index (NavDef → qn) during tree-walking.
      // Same pattern as writeHandlerMap/projectionMap/multiStreamProjectionMap
      // (see `{ ...def, name: qualified }` above). Feature-side
      // `feature.screens[shortId]` keeps the short id — only the registry
      // surface flips.
      const stored = { ...screenDef, id: qualified };
      screenMap.set(qualified, stored);
      screenFeatureMap.set(qualified, feature.name);
      // entity-Index nur für Screens die direkt an einer Entity hängen.
      // entityList/entityEdit haben `entity`; custom + actionForm haben
      // keinen entity-Bezug (custom ist opaque, actionForm hat inline
      // fields ohne Entity-Reference).
      if (stored.type === "entityList" || stored.type === "entityEdit") {
        const existing = screensByEntity.get(stored.entity) ?? [];
        existing.push(stored);
        screensByEntity.set(stored.entity, existing);
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
      navMap.set(qualified, stored);
      navFeatureMap.set(qualified, feature.name);
      if (stored.parent === undefined) {
        topLevelNavs.push(stored);
      } else {
        const existing = navsByParent.get(stored.parent) ?? [];
        existing.push(stored);
        navsByParent.set(stored.parent, existing);
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
      workspaceMap.set(qualified, stored);
      workspaceFeatureMap.set(qualified, feature.name);
      // Seed the membership list with the workspace's explicit nav refs in
      // declaration order. Boot-validator checks the QNs resolve.
      navsByWorkspace.set(qualified, [...(stored.nav ?? [])]);
      if (stored.default === true) {
        // Boot-validator enforces uniqueness; here we just remember the
        // first one and let validateBoot complain if there's a second.
        if (defaultWorkspace === undefined) {
          defaultWorkspace = stored;
        }
      }
    }

    // Visual-Tree slots — at-most-one per feature (only-once-guard im
    // registrar). Erased Maps für Runtime-Lookup; compile-time-typed
    // Surface läuft über FeatureDefinition.exports (TreeActionsHandle).
    if (feature.treeProvider !== undefined) {
      treeProvidersMap.set(feature.name, feature.treeProvider);
    }
    if (feature.treeActions !== undefined) {
      treeActionsMap.set(feature.name, feature.treeActions);
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
      authClaimsHooks.push({
        featureName: feature.name,
        fn,
        ...(declaredKeys && { declaredKeys }),
      });
    }
  }

  // Pass 2 for workspaces: fold any nav-self-assigned QNs into their
  // workspace's member list. We can do this safely now that every feature
  // (and therefore every workspace) is in workspaceMap. Cross-feature refs
  // — a nav from feature A self-assigning to a workspace from feature B —
  // resolve here because B's workspace was registered in pass 1 above.
  // Dedup: a nav entry that's also in r.workspace({ nav: [...] }) shouldn't
  // appear twice. Boot-validator catches dangling workspace ids.
  for (const [navQn, navDef] of navMap) {
    if (!navDef.workspaces || navDef.workspaces.length === 0) continue;
    for (const wsQn of navDef.workspaces) {
      const members = navsByWorkspace.get(wsQn);
      if (members === undefined) continue; // dangling — boot-validator reports
      if (!members.includes(navQn)) members.push(navQn);
    }
  }

  // Build handler → entity mapping from feature declarations (filled by tryMapEntity
  // in defineFeature via the "entityName:verb" colon convention).
  // Must happen before extension processing since extension preSave hooks need entity mappings.
  for (const feature of features) {
    for (const [handlerName, entityName] of Object.entries(feature.handlerEntityMappings ?? {})) {
      const writeQn = qualify(feature.name, "write", handlerName);
      const queryQn = qualify(feature.name, "query", handlerName);
      if (writeHandlerMap.has(writeQn)) {
        handlerEntityMap.set(writeQn, entityName);
      }
      if (queryHandlerMap.has(queryQn)) {
        handlerEntityMap.set(queryQn, entityName);
      }
    }
  }

  // Process extension usages: call onRegister, apply extendSchema, register hooks
  for (const usage of extensionUsages) {
    const ext = extensionMap.get(usage.extensionName);
    if (!ext) continue;

    if (ext.onRegister) {
      ext.onRegister(usage.entityName, usage.options);
    }

    // extendSchema: merge extra fields into entity definition
    if (ext.extendSchema) {
      const entity = entityMap.get(usage.entityName);
      if (entity) {
        const extraFields = ext.extendSchema(usage.entityName);
        const merged = { ...entity, fields: { ...entity.fields, ...extraFields } };
        entityMap.set(usage.entityName, merged);
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
        const existing = entityPostSaveHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.postSave,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        entityPostSaveHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.preDelete) {
        const existing = entityPreDeleteHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.preDelete,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        entityPreDeleteHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.postDelete) {
        const existing = entityPostDeleteHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.postDelete,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        entityPostDeleteHooks.set(usage.entityName, existing);
      }
      // preSave on extensions: store as handler hook for all CRUD handlers of this entity
      if (ext.hooks.preSave) {
        // Find all write handlers that belong to this entity via handlerEntityMap
        for (const qualifiedHandler of writeHandlerMap.keys()) {
          if (handlerEntityMap.get(qualifiedHandler) === usage.entityName) {
            const existing = preSaveHooks.get(qualifiedHandler) ?? [];
            existing.push({ fn: ext.hooks.preSave, featureName: extOwner });
            preSaveHooks.set(qualifiedHandler, existing);
          }
        }
      }
    }
  }

  // Precompute: searchable/sortable fields, search includes, incoming relations
  const searchableFieldsCache = new Map<string, readonly string[]>();
  const sortableFieldsCache = new Map<string, readonly string[]>();
  const searchIncludesCache = new Map<string, ReadonlyMap<string, readonly string[]>>();
  const incomingRelationsCache = new Map<string, IncomingRelation[]>();

  for (const [name, entity] of entityMap) {
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
    searchableFieldsCache.set(name, searchable);
    sortableFieldsCache.set(name, sortable);
  }

  // Implicit-Projection pro r.entity. Macht die Entity-Tabelle rebaubar
  // ohne dass Apps eine explizite r.projection schreiben müssen.
  // Naming-Convention: `<feature>:projection:<entityName>-entity` — der
  // "-entity"-Suffix unterscheidet implicit von explicit-Projections und
  // vermeidet Kollisionen wenn jemand z.B. eine Cross-Aggregate-Projection
  // mit Entity-Name registriert.
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const def = buildImplicitProjection(feature.name, entityName, entity, qualify);
      if (projectionMap.has(def.name)) {
        throw new Error(
          `Implicit projection "${def.name}" kollidiert mit einer explizit registrierten r.projection. ` +
            `Implicit-Projections werden für jede r.entity mit "-entity"-Suffix angelegt — ` +
            `benenne deine explicit projection um (z.B. "<entity>-summary") um die Kollision aufzulösen.`,
        );
      }
      projectionMap.set(def.name, def);
      const existing = projectionsBySource.get(entityName) ?? [];
      existing.push(def);
      projectionsBySource.set(entityName, existing);
    }
  }

  // Cross-cut: a r.rawTable() PgTable must not coincide with any
  // registered projection's table. Silent dedupe via Set would mask a
  // real authoring bug (two owners writing to the same physical table).
  // Run after both passes so implicit projections are visible too.
  const projectionTables = new Set<unknown>();
  for (const proj of projectionMap.values()) projectionTables.add(proj.table);
  for (const msp of multiStreamProjectionMap.values()) {
    if (msp.table) projectionTables.add(msp.table);
  }
  for (const raw of rawTableMap.values()) {
    if (projectionTables.has(raw.table)) {
      throw new Error(
        `r.rawTable "${raw.name}" (feature "${raw.featureName}") shares a Drizzle ` +
          `PgTable with a registered projection. Pick one owner: r.entity() / ` +
          `r.projection() for event-sourced reads, r.rawTable() for the bypass.`,
      );
    }
  }

  for (const [entityName, rels] of relationMap) {
    const includes = new Map<string, readonly string[]>();
    for (const [relName, rel] of Object.entries(rels)) {
      if ((rel.type === "belongsTo" || rel.type === "manyToMany") && rel.searchInclude?.length) {
        includes.set(relName, rel.searchInclude);
      }
    }
    searchIncludesCache.set(entityName, includes);

    // Build reverse index for incoming relations
    for (const [relName, rel] of Object.entries(rels)) {
      const existing = incomingRelationsCache.get(rel.target) ?? [];
      existing.push({ sourceEntity: entityName, relationName: relName, relation: rel });
      incomingRelationsCache.set(rel.target, existing);
    }
  }

  // Validate: handlers in features with field-access rules must be entity-mapped.
  // Without entity mapping, field-level access checks are silently skipped (security gap).
  // Convention: "entityName.action" = entity-bound (must resolve), "action" = standalone (no filter).
  for (const feature of features) {
    if (!hasFieldAccessRules(feature)) continue;

    // Write handlers: ALL must be entity-mapped (security-critical, writes need field-access checks)
    for (const handlerName of Object.keys(feature.writeHandlers)) {
      const qualified = qualify(feature.name, "write", handlerName);
      if (!handlerEntityMap.has(qualified)) {
        throw new Error(
          `Write handler "${qualified}" is not mapped to any entity, but feature "${feature.name}" has field-level access rules. ` +
            `Name must follow "entity:action" convention (e.g. "user:create") so field-access checks apply.`,
        );
      }
    }

    // Query handlers: only those with a dash must resolve (typo protection).
    // No dash = standalone query (dashboard, stats) — intentionally not entity-bound.
    for (const handlerName of Object.keys(feature.queryHandlers)) {
      if (!handlerName.includes(":")) continue;
      const qualified = qualify(feature.name, "query", handlerName);
      if (!handlerEntityMap.has(qualified)) {
        throw new Error(
          `Query handler "${qualified}" looks entity-bound but no matching entity exists. ` +
            `Either fix the entity name, or use a name without colons for standalone queries.`,
        );
      }
    }
  }

  // Validate: all relation targets must reference existing entities
  for (const [entityName, rels] of relationMap) {
    for (const [relName, rel] of Object.entries(rels)) {
      if (!entityMap.has(rel.target)) {
        throw new Error(
          `Relation "${entityName}.${relName}" targets entity "${rel.target}" which does not exist`,
        );
      }
    }
  }

  // Build + validate event upcaster chains. Run AFTER all features are
  // ingested so r.eventMigration calls can reference events from any
  // feature (same feature in practice, but the check stays lax for future
  // cross-feature event packs).
  for (const feature of features) {
    for (const [shortName, migrations] of Object.entries(feature.eventMigrations ?? {})) {
      const qualified = qualify(feature.name, "event", shortName);
      const eventDef = eventMap.get(qualified);
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

  // Stitch the upcaster chain per qualified event. At this point, gaps in
  // the chain (e.g. defineEvent version=3 but only a 1→2 migration exists)
  // are hard errors — they would silently hand a v2-shape payload to a
  // consumer expecting v3 at runtime, which is the class of bug upcasters
  // are supposed to prevent.
  for (const [qualified, eventDef] of eventMap) {
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
    eventUpcasterMap.set(qualified, {
      currentVersion: eventDef.version,
      chain: chainMap,
    });
  }

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
  const AUTO_EVENT_VERBS = ["created", "updated", "deleted", "restored"] as const;
  const allDomainEventNames = new Set(eventMap.keys());
  for (const [projName, projDef] of projectionMap) {
    const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
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
    const isEventsOnlySource = !sources.every((src) => entityMap.has(src));
    for (const src of sources) {
      if (entityMap.has(src)) {
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
        const unregistered = sources.filter((src) => !entityMap.has(src));
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

  // Validate: all required features must be registered
  for (const feature of features) {
    for (const required of feature.requires ?? []) {
      if (!featureMap.has(required)) {
        throw new Error(
          `Feature "${feature.name}" requires feature "${required}" which is not registered`,
        );
      }
    }
  }

  // Resolve notification triggers and register postSave hooks
  // Done after all features are registered so cross-feature triggers work
  const allHandlerNames = new Set([...writeHandlerMap.keys(), ...queryHandlerMap.keys()]);
  for (const [qualifiedName, notifDef] of notificationMap) {
    // Both maps are populated in lockstep — same key-set by construction.
    const featureName = notificationFeatureMap.get(qualifiedName) as string; // @cast-boundary engine-bridge
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
    notificationMap.set(qualifiedName, { ...notifDef, trigger: { on: triggerOn } });

    if (!postSaveHooks.has(triggerOn)) postSaveHooks.set(triggerOn, []);
    postSaveHooks.get(triggerOn)?.push({
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

  // Validate: lifecycle hook targets must reference existing handlers
  const allHandlers = allHandlerNames;
  const lifecycleHookMaps = [
    { map: preSaveHooks, phase: "preSave" },
    { map: postSaveHooks, phase: "postSave" },
    { map: preDeleteHooks, phase: "preDelete" },
    { map: postDeleteHooks, phase: "postDelete" },
    { map: preQueryHooks, phase: "preQuery" },
    { map: postQueryHooks, phase: "postQuery" },
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
    { map: entityPostSaveHooks, phase: "postSave (entityHook)" },
    { map: entityPreDeleteHooks, phase: "preDelete (entityHook)" },
    { map: entityPostDeleteHooks, phase: "postDelete (entityHook)" },
    { map: entityPostQueryHooks, phase: "postQuery (entityHook)" },
    { map: searchPayloadExtensions, phase: "searchPayloadExtension" },
  ] as const;
  for (const { map, phase } of entityHookMaps) {
    for (const entityName of map.keys()) {
      if (!allEntities.has(entityName)) {
        throw new Error(
          `${phase} hook targets entity "${entityName}" but no entity with that name exists. ` +
            `Check for typos — the hook will never fire.`,
        );
      }
    }
  }

  // Validate: job event triggers must reference existing handlers.
  // Multi-Trigger-Form: jeden Eintrag im Array gegen allHandlers prüfen,
  // auch wenn nur einer fehlt fail-fast.
  for (const [jobName, jobDef] of jobMap) {
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

  // Validate: extension usages must reference existing extensions
  for (const usage of extensionUsages) {
    if (!extensionMap.has(usage.extensionName)) {
      throw new Error(
        `Extension usage "${usage.extensionName}" on entity "${usage.entityName}" references an extension that does not exist`,
      );
    }
  }

  // Pre-compute: any handler with a rateLimit option? Keeps the boot
  // path able to short-circuit the RateLimitResolver wiring (and its
  // Lua-script registration on Redis) when nobody opted in.
  const hasRateLimitedHandlerCached = (() => {
    for (const h of writeHandlerMap.values()) if (h.rateLimit !== undefined) return true;
    for (const h of queryHandlerMap.values()) if (h.rateLimit !== undefined) return true;
    return false;
  })();

  return {
    features: featureMap,

    getFeature(name: string): FeatureDefinition | undefined {
      return featureMap.get(name);
    },

    hasRateLimitedHandler(): boolean {
      return hasRateLimitedHandlerCached;
    },

    getEntity(name: string): EntityDefinition | undefined {
      return entityMap.get(name);
    },

    getWriteHandler(name: string): WriteHandlerDef | undefined {
      return writeHandlerMap.get(name);
    },

    getQueryHandler(name: string): QueryHandlerDef | undefined {
      return queryHandlerMap.get(name);
    },

    getSearchableFields(entityName: string): readonly string[] {
      return searchableFieldsCache.get(entityName) ?? [];
    },

    getSortableFields(entityName: string): readonly string[] {
      return sortableFieldsCache.get(entityName) ?? [];
    },

    getRelations(entityName: string): EntityRelations {
      return (relationMap.get(entityName) ?? {}) as EntityRelations; // @cast-boundary schema-walk
    },

    getSearchIncludes(entityName: string): ReadonlyMap<string, readonly string[]> {
      return searchIncludesCache.get(entityName) ?? new Map();
    },

    getIncomingRelations(entityName: string): readonly IncomingRelation[] {
      return incomingRelationsCache.get(entityName) ?? [];
    },

    getPreSaveHooks(
      name: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreSaveHookFn[] {
      return filterOwned(preSaveHooks.get(name), effectiveFeatures);
    },

    getPostSaveHooks(
      name: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostSaveHookFn[] {
      return filterByPhase(postSaveHooks.get(name), phase, effectiveFeatures);
    },

    getPreDeleteHooks(
      name: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreDeleteHookFn[] {
      return filterByPhase(preDeleteHooks.get(name), phase, effectiveFeatures);
    },

    getPostDeleteHooks(
      name: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostDeleteHookFn[] {
      return filterByPhase(postDeleteHooks.get(name), phase, effectiveFeatures);
    },

    getPreQueryHooks(
      name: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreQueryHookFn[] {
      return filterOwned(preQueryHooks.get(name), effectiveFeatures);
    },

    getPostQueryHooks(
      name: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostQueryHookFn[] {
      return filterOwned(postQueryHooks.get(name), effectiveFeatures);
    },

    // Entity hooks — fire for all writes on an entity
    getEntityPostSaveHooks(
      entityName: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostSaveHookFn[] {
      return filterByPhase(entityPostSaveHooks.get(entityName), phase, effectiveFeatures);
    },

    getEntityPreDeleteHooks(
      entityName: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PreDeleteHookFn[] {
      return filterByPhase(entityPreDeleteHooks.get(entityName), phase, effectiveFeatures);
    },

    getEntityPostDeleteHooks(
      entityName: string,
      phase?: HookPhase,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostDeleteHookFn[] {
      return filterByPhase(entityPostDeleteHooks.get(entityName), phase, effectiveFeatures);
    },

    getEntityPostQueryHooks(
      entityName: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly PostQueryHookFn[] {
      return filterOwned(entityPostQueryHooks.get(entityName), effectiveFeatures);
    },

    // F3 — Search-Payload-Extension contributors for an entity. Used by
    // `buildSearchDocument` in system-hooks.ts to enrich the indexed payload.
    // `effectiveFeatures` filters out contributors owned by feature-toggle-
    // disabled features (parallel to getEntityPostQueryHooks etc.).
    getSearchPayloadExtensions(
      entityName: string,
      effectiveFeatures?: ReadonlySet<string>,
    ): readonly SearchPayloadContributorFn[] {
      return filterOwned(searchPayloadExtensions.get(entityName), effectiveFeatures);
    },

    getAllTranslations(): TranslationKeys {
      return mergedTranslations;
    },

    getHandlerEntity(qualifiedHandler: string): string | undefined {
      return handlerEntityMap.get(qualifiedHandler);
    },

    isHandlerSystemScoped(qualifiedHandler: string): boolean {
      const featureName = handlerFeatureMap.get(qualifiedHandler);
      if (!featureName) return false;
      return featureMap.get(featureName)?.systemScope ?? false;
    },

    getHandlerFeature(qualifiedHandler: string): string | undefined {
      return handlerFeatureMap.get(qualifiedHandler);
    },

    getAllMetrics() {
      return metricMap;
    },

    getAllSecretKeys(): ReadonlyMap<string, SecretKeyDefinition> {
      return secretKeyMap;
    },

    getSecretKey(qualifiedName: string): SecretKeyDefinition | undefined {
      return secretKeyMap.get(qualifiedName);
    },

    getConfigKey(qualifiedKey: string): ConfigKeyDefinition | undefined {
      return configKeyMap.get(qualifiedKey);
    },

    getAllConfigKeys(): ReadonlyMap<string, ConfigKeyDefinition> {
      return configKeyMap;
    },

    getJob(qualifiedName: string): JobDefinition | undefined {
      return jobMap.get(qualifiedName);
    },

    getAllJobs(): ReadonlyMap<string, JobDefinition> {
      return jobMap;
    },

    getEvent(qualifiedName: string): EventDef | undefined {
      return eventMap.get(qualifiedName);
    },

    getEventUpcasters() {
      return eventUpcasterMap;
    },

    getExtension(name: string): RegistrarExtensionDef | undefined {
      return extensionMap.get(name);
    },

    getExtensionUsages(extensionName: string): readonly RegistrarExtensionRegistration[] {
      return extensionUsages.filter((u) => u.extensionName === extensionName);
    },

    getAllNotifications(): ReadonlyMap<string, NotificationDefinition> {
      return notificationMap;
    },

    getAllReferenceData(): readonly ReferenceDataDef[] {
      return allReferenceData;
    },

    getAllConfigSeeds(): readonly ConfigSeedDef[] {
      return allConfigSeeds;
    },

    getProjectionsForSource(entityName: string): readonly ProjectionDefinition[] {
      return projectionsBySource.get(entityName) ?? [];
    },

    getAllProjections(): ReadonlyMap<string, ProjectionDefinition> {
      return projectionMap;
    },

    getAllRawTables(): ReadonlyMap<string, RawTableDef> {
      return rawTableMap;
    },

    getAllMultiStreamProjections(): ReadonlyMap<string, MultiStreamProjectionDefinition> {
      return multiStreamProjectionMap;
    },

    getMultiStreamProjectionFeature(qualifiedName: string): string | undefined {
      return multiStreamProjectionFeatureMap.get(qualifiedName);
    },

    getAuthClaimsHooks(): readonly AuthClaimsHookDef[] {
      return authClaimsHooks;
    },

    getAllClaimKeys(): ReadonlyMap<string, ClaimKeyDefinition> {
      return claimKeyMap;
    },

    getClaimKey(qualifiedName: string): ClaimKeyDefinition | undefined {
      return claimKeyMap.get(qualifiedName);
    },

    getAllScreens(): ReadonlyMap<string, ScreenDefinition> {
      return screenMap;
    },

    getScreen(qualifiedName: string): ScreenDefinition | undefined {
      return screenMap.get(qualifiedName);
    },

    getScreenFeature(qualifiedName: string): string | undefined {
      return screenFeatureMap.get(qualifiedName);
    },

    getScreensByEntity(entityName: string): readonly ScreenDefinition[] {
      return screensByEntity.get(entityName) ?? [];
    },

    getAllNavs(): ReadonlyMap<string, NavDefinition> {
      return navMap;
    },

    getNav(qualifiedName: string): NavDefinition | undefined {
      return navMap.get(qualifiedName);
    },

    getNavFeature(qualifiedName: string): string | undefined {
      return navFeatureMap.get(qualifiedName);
    },

    getNavsByParent(parentQualifiedName: string): readonly NavDefinition[] {
      return navsByParent.get(parentQualifiedName) ?? [];
    },

    getTopLevelNavs(): readonly NavDefinition[] {
      return topLevelNavs;
    },

    getAllWorkspaces(): ReadonlyMap<string, WorkspaceDefinition> {
      return workspaceMap;
    },

    getWorkspace(qualifiedName: string): WorkspaceDefinition | undefined {
      return workspaceMap.get(qualifiedName);
    },

    getWorkspaceFeature(qualifiedName: string): string | undefined {
      return workspaceFeatureMap.get(qualifiedName);
    },

    getWorkspaceNavs(workspaceQualifiedName: string): readonly string[] {
      return navsByWorkspace.get(workspaceQualifiedName) ?? [];
    },

    getDefaultWorkspace(): WorkspaceDefinition | undefined {
      return defaultWorkspace;
    },

    getTreeProviders(): ReadonlyMap<string, TreeChildrenSubscribe> {
      return treeProvidersMap;
    },

    getTreeActions(featureName: string): Readonly<Record<string, TreeActionDef>> | undefined {
      return treeActionsMap.get(featureName);
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
