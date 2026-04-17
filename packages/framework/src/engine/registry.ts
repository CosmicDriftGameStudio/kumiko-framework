import { buildMetricName, validateMetricName } from "../observability";
import { type QnType, qn, toKebab } from "./qualified-name";
import type {
  ConfigKeyDefinition,
  EntityDefinition,
  EntityRelations,
  EventDef,
  FeatureDefinition,
  FeatureMetricDef,
  HookPhase,
  JobDefinition,
  NotificationDefinition,
  PhasedHook,
  PostDeleteHookFn,
  PostEventSubscriberDef,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ProjectionDefinition,
  QueryHandlerDef,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  Registry,
  RelationDefinition,
  TranslationKeys,
  WriteHandlerDef,
} from "./types";
import { HookPhases } from "./types";
import { resolveName } from "./types/handlers";

type IncomingRelation = {
  sourceEntity: string;
  relationName: string;
  relation: RelationDefinition;
};

// This is where the magic happens. By "magic" I mean: precomputed maps.
// I build everything once at boot (hooks, relations, searchable fields, ...)
// so nothing has to iterate over objects at runtime. O(1) instead of O(n*m).
export function createRegistry(features: readonly FeatureDefinition[]): Registry {
  const featureMap = new Map<string, FeatureDefinition>();
  const entityMap = new Map<string, EntityDefinition>();
  const relationMap = new Map<string, Record<string, RelationDefinition>>();
  const writeHandlerMap = new Map<string, WriteHandlerDef>();
  const queryHandlerMap = new Map<string, QueryHandlerDef>();
  const preSaveHooks = new Map<string, PreSaveHookFn[]>();
  const postSaveHooks = new Map<string, PhasedHook<PostSaveHookFn>[]>();
  const preDeleteHooks = new Map<string, PhasedHook<PreDeleteHookFn>[]>();
  const postDeleteHooks = new Map<string, PhasedHook<PostDeleteHookFn>[]>();
  const preQueryHooks = new Map<string, PreQueryHookFn[]>();
  // Entity hooks — keyed by entity name, NOT prefixed
  const entityPostSaveHooks = new Map<string, PhasedHook<PostSaveHookFn>[]>();
  const entityPreDeleteHooks = new Map<string, PhasedHook<PreDeleteHookFn>[]>();
  const entityPostDeleteHooks = new Map<string, PhasedHook<PostDeleteHookFn>[]>();
  const configKeyMap = new Map<string, ConfigKeyDefinition>();
  const jobMap = new Map<string, JobDefinition>();
  const notificationMap = new Map<string, NotificationDefinition>();
  const notificationFeatureMap = new Map<string, string>(); // qualifiedName → featureName
  const eventMap = new Map<string, EventDef>();
  // Handler → entity mapping (populated from entities + handler name convention)
  const handlerEntityMap = new Map<string, string>();
  // Handler → feature mapping (for systemScope check)
  const handlerFeatureMap = new Map<string, string>();
  const extensionMap = new Map<string, RegistrarExtensionDef>();
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  const allReferenceData: ReferenceDataDef[] = [];
  const mergedTranslations: Record<string, Record<string, string>> = {};
  // Metric registry — keyed by fully qualified name (kumiko_<feature>_<short>).
  // Boot-time validation rejects bad names; dashboards then safely rely on shape.
  const metricMap = new Map<string, FeatureMetricDef & { readonly featureName: string }>();
  // Projections — full list keyed by qualified name AND a source-entity index
  // the executor consults on every write. Index is precomputed so the hot path
  // does a single Map.get, never a scan.
  const projectionMap = new Map<string, ProjectionDefinition>();
  const projectionsBySource = new Map<string, ProjectionDefinition[]>();

  // Post-event subscribers — qualified name → subscriber. One row in
  // kumiko_event_consumers per qualified name; the event-dispatcher iterates
  // this map to fan events out.
  const postEventSubscriberMap = new Map<string, PostEventSubscriberDef>();

  // Qualified name helper: builds "scope:type:name" from feature + type + short name.
  // Both feature name and handler name are converted to kebab-case.
  function qualify(featureName: string, type: QnType, name: string): string {
    return qn(toKebab(featureName), type, toKebab(name));
  }

  // Extract hook fns, optionally filtered by phase.
  // When phase is undefined, returns all hooks (used by code that doesn't care about phase).
  function filterByPhase<TFn>(
    list: readonly PhasedHook<TFn>[] | undefined,
    phase: HookPhase | undefined,
  ): readonly TFn[] {
    if (!list || list.length === 0) return [];
    if (phase === undefined) return list.map((p) => p.fn);
    const result: TFn[] = [];
    for (const entry of list) {
      if (entry.phase === phase) result.push(entry.fn);
    }
    return result;
  }

  // Merge hooks without prefix (entity hooks)
  function mergeHookList<T>(
    map: Map<string, T[]>,
    source: Readonly<Record<string, readonly T[]>>,
  ): void {
    for (const [name, fns] of Object.entries(source)) {
      const existing = map.get(name) ?? [];
      existing.push(...(fns as T[]));
      map.set(name, existing);
    }
  }

  // Merge hooks with feature prefix (handler hooks).
  // Hook keys are handler QNs — hooks don't get their own QN, they're keyed by the handler they target.
  // The hookQnType indicates whether the targeted handler is a write or query handler.
  function mergeHookListQualified<T>(
    map: Map<string, T[]>,
    source: Readonly<Record<string, readonly T[]>>,
    featureName: string,
    hookQnType: QnType,
  ): void {
    for (const [name, fns] of Object.entries(source)) {
      const qualified = qualify(featureName, hookQnType, name);
      const existing = map.get(qualified) ?? [];
      existing.push(...(fns as T[]));
      map.set(qualified, existing);
    }
  }

  for (const feature of features) {
    if (featureMap.has(feature.name)) {
      throw new Error(`Duplicate feature: "${feature.name}"`);
    }
    featureMap.set(feature.name, feature);

    // Entities: NOT prefixed — entity names must be globally unique
    for (const [name, entity] of Object.entries(feature.entities)) {
      if (entityMap.has(name)) {
        throw new Error(`Duplicate entity: "${name}" (registered by multiple features)`);
      }
      entityMap.set(name, entity);
    }

    // Relations: entityName (not prefixed)
    for (const [entityName, rels] of Object.entries(feature.relations)) {
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
    for (const [name, handler] of Object.entries(feature.writeHandlers)) {
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
    for (const [name, handler] of Object.entries(feature.queryHandlers)) {
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
    for (const [key, keyDef] of Object.entries(feature.configKeys)) {
      const qualifiedKey = qualify(feature.name, "config", key);
      if (configKeyMap.has(qualifiedKey)) {
        throw new Error(
          `Duplicate config key: "${qualifiedKey}" (registered by multiple features)`,
        );
      }
      configKeyMap.set(qualifiedKey, keyDef);
    }

    // Jobs: scope:job:name
    for (const [name, jobDef] of Object.entries(feature.jobs)) {
      const qualifiedName = qualify(feature.name, "job", name);
      if (jobMap.has(qualifiedName)) {
        throw new Error(`Duplicate job: "${qualifiedName}" (registered by multiple features)`);
      }
      jobMap.set(qualifiedName, { ...jobDef, name: qualifiedName });
    }

    // Notifications: scope:notify:name
    for (const [name, notifDef] of Object.entries(feature.notifications)) {
      const qualifiedName = qualify(feature.name, "notify", name);
      notificationMap.set(qualifiedName, {
        ...notifDef,
        name: qualifiedName,
        trigger: { on: notifDef.trigger.on },
      });
      notificationFeatureMap.set(qualifiedName, feature.name);
    }

    // Events: scope:event:name
    for (const [eventName, eventDef] of Object.entries(feature.events)) {
      const qualified = qualify(feature.name, "event", eventName);
      eventMap.set(qualified, { ...eventDef, name: qualified });
    }

    // Translations prefixed with featureName: (i18next namespace convention)
    for (const [key, value] of Object.entries(feature.translations)) {
      mergedTranslations[`${feature.name}:${key}`] = value;
    }

    // Lifecycle hooks: keyed by handler QN.
    // Save/delete hooks target write handlers, query hooks target query handlers.
    mergeHookListQualified(preSaveHooks, feature.hooks.preSave, feature.name, "write");
    mergeHookListQualified(postSaveHooks, feature.hooks.postSave, feature.name, "write");
    mergeHookListQualified(preDeleteHooks, feature.hooks.preDelete, feature.name, "write");
    mergeHookListQualified(postDeleteHooks, feature.hooks.postDelete, feature.name, "write");
    mergeHookListQualified(preQueryHooks, feature.hooks.preQuery, feature.name, "query");

    // Entity hooks: NOT prefixed, keyed by entity name
    mergeHookList(entityPostSaveHooks, feature.entityHooks.postSave);
    mergeHookList(entityPreDeleteHooks, feature.entityHooks.preDelete);
    mergeHookList(entityPostDeleteHooks, feature.entityHooks.postDelete);

    // Registrar extensions: collect definitions and usages
    for (const [extName, extDef] of Object.entries(feature.registrarExtensions)) {
      if (extensionMap.has(extName)) {
        throw new Error(
          `Duplicate registrar extension: "${extName}" (registered by multiple features)`,
        );
      }
      extensionMap.set(extName, extDef);
    }
    extensionUsages.push(...feature.extensionUsages);
    allReferenceData.push(...feature.referenceData);

    // Metrics: validate + qualify per feature. Collisions across features are
    // rejected here — two features can't both register "created_total" under
    // different shapes (labels/type) because the resulting fully qualified
    // names differ, but same short+feature combo would already fail in
    // defineFeature. This loop catches cross-feature/extension edge cases.
    for (const [shortName, def] of Object.entries(feature.metrics)) {
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

    // Projections: qualified by feature name. Build the source-entity index so
    // the event-store-executor can fetch matching projections in O(1) per write.
    for (const [projName, projDef] of Object.entries(feature.projections)) {
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

    // Post-event subscribers: qualified by feature name. Each becomes its own
    // row in kumiko_event_consumers with an independent cursor, so one broken
    // subscriber doesn't stall another. Duplicate qualified names mean two
    // features declared the same short name — that would silently collide
    // cursors, so fail loudly at boot.
    for (const [shortName, subDef] of Object.entries(feature.postEventSubscribers)) {
      const qualified = qualify(feature.name, "consumer", shortName);
      if (postEventSubscriberMap.has(qualified)) {
        throw new Error(
          `Duplicate postEvent subscriber: "${qualified}" (registered by multiple features)`,
        );
      }
      postEventSubscriberMap.set(qualified, { ...subDef, name: qualified });
    }
  }

  // Build handler → entity mapping from explicit feature declarations (set by r.crud() and tryMapEntity).
  // Must happen before extension processing since extension preSave hooks need entity mappings.
  for (const feature of features) {
    for (const [handlerName, entityName] of Object.entries(feature.handlerEntityMappings)) {
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
    if (ext.hooks) {
      if (ext.hooks.postSave) {
        const existing = entityPostSaveHooks.get(usage.entityName) ?? [];
        existing.push({ fn: ext.hooks.postSave, phase: HookPhases.afterCommit });
        entityPostSaveHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.preDelete) {
        const existing = entityPreDeleteHooks.get(usage.entityName) ?? [];
        existing.push({ fn: ext.hooks.preDelete, phase: HookPhases.afterCommit });
        entityPreDeleteHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.postDelete) {
        const existing = entityPostDeleteHooks.get(usage.entityName) ?? [];
        existing.push({ fn: ext.hooks.postDelete, phase: HookPhases.afterCommit });
        entityPostDeleteHooks.set(usage.entityName, existing);
      }
      // preSave on extensions: store as handler hook for all CRUD handlers of this entity
      if (ext.hooks.preSave) {
        // Find all write handlers that belong to this entity via handlerEntityMap
        for (const qualifiedHandler of writeHandlerMap.keys()) {
          if (handlerEntityMap.get(qualifiedHandler) === usage.entityName) {
            const existing = preSaveHooks.get(qualifiedHandler) ?? [];
            existing.push(ext.hooks.preSave);
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

  // Validate: every projection's source must reference a registered entity.
  // A typo ("unti" instead of "unit") would otherwise be a silent no-op —
  // the projection is stored but never fires because no aggregateType ever
  // matches. Fail at boot so the feature author sees it immediately.
  //
  // Same guard extends to apply-keys: a handler for "unit.creatd" (missing
  // 'e') would silently never fire. We enumerate the currently-known event
  // types per source (the four auto-generated CRUD types) and reject apply
  // handlers that don't match any of them. When r.event() lands in Phase 4,
  // the valid-type set gets extended to include registered domain events.
  const AUTO_EVENT_VERBS = ["created", "updated", "deleted", "restored"] as const;
  for (const [projName, projDef] of projectionMap) {
    const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
    const validEventTypes = new Set<string>();
    for (const src of sources) {
      if (!entityMap.has(src)) {
        throw new Error(
          `Projection "${projName}" declares source entity "${src}" which is not registered. ` +
            `Did you forget r.entity("${src}", ...) or misspell the name?`,
        );
      }
      for (const verb of AUTO_EVENT_VERBS) validEventTypes.add(`${src}.${verb}`);
    }
    for (const applyKey of Object.keys(projDef.apply)) {
      if (!validEventTypes.has(applyKey)) {
        throw new Error(
          `Projection "${projName}" has an apply handler for "${applyKey}" but no such event ` +
            `type exists for its source(s) [${sources.join(", ")}]. ` +
            `Valid types: ${[...validEventTypes].join(", ")}. ` +
            `Check for a typo in the event-type string.`,
        );
      }
    }
  }

  // Validate: all required features must be registered
  for (const feature of features) {
    for (const required of feature.requires) {
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
    const featureName = notificationFeatureMap.get(qualifiedName) as string;
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

  // Validate: job event triggers must reference existing handlers
  for (const [jobName, jobDef] of jobMap) {
    if ("on" in jobDef.trigger) {
      const rawName = resolveName(jobDef.trigger.on);
      // If already a valid QN (cross-feature ref), check directly
      if (allHandlers.has(rawName)) continue;
      // Otherwise resolve: try the raw name as-is, it may already be qualified
      if (!allHandlers.has(rawName)) {
        throw new Error(
          `Job "${jobName}" triggers on "${rawName}" but no handler with that name exists`,
        );
      }
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

  return {
    features: featureMap,

    getFeature(name: string): FeatureDefinition | undefined {
      return featureMap.get(name);
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
      return (relationMap.get(entityName) ?? {}) as EntityRelations;
    },

    getSearchIncludes(entityName: string): ReadonlyMap<string, readonly string[]> {
      return searchIncludesCache.get(entityName) ?? new Map();
    },

    getIncomingRelations(entityName: string): readonly IncomingRelation[] {
      return incomingRelationsCache.get(entityName) ?? [];
    },

    getPreSaveHooks(name: string): readonly PreSaveHookFn[] {
      return preSaveHooks.get(name) ?? [];
    },

    getPostSaveHooks(name: string, phase?: HookPhase): readonly PostSaveHookFn[] {
      return filterByPhase(postSaveHooks.get(name), phase);
    },

    getPreDeleteHooks(name: string, phase?: HookPhase): readonly PreDeleteHookFn[] {
      return filterByPhase(preDeleteHooks.get(name), phase);
    },

    getPostDeleteHooks(name: string, phase?: HookPhase): readonly PostDeleteHookFn[] {
      return filterByPhase(postDeleteHooks.get(name), phase);
    },

    getPreQueryHooks(name: string): readonly PreQueryHookFn[] {
      return preQueryHooks.get(name) ?? [];
    },

    // Entity hooks — fire for all writes on an entity
    getEntityPostSaveHooks(entityName: string, phase?: HookPhase): readonly PostSaveHookFn[] {
      return filterByPhase(entityPostSaveHooks.get(entityName), phase);
    },

    getEntityPreDeleteHooks(entityName: string, phase?: HookPhase): readonly PreDeleteHookFn[] {
      return filterByPhase(entityPreDeleteHooks.get(entityName), phase);
    },

    getEntityPostDeleteHooks(entityName: string, phase?: HookPhase): readonly PostDeleteHookFn[] {
      return filterByPhase(entityPostDeleteHooks.get(entityName), phase);
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

    getProjectionsForSource(entityName: string): readonly ProjectionDefinition[] {
      return projectionsBySource.get(entityName) ?? [];
    },

    getAllProjections(): ReadonlyMap<string, ProjectionDefinition> {
      return projectionMap;
    },

    getAllPostEventSubscribers(): ReadonlyMap<string, PostEventSubscriberDef> {
      return postEventSubscriberMap;
    },
  };
}

/** Returns true if any entity in the feature has field-level access rules (read or write). */
function hasFieldAccessRules(feature: FeatureDefinition): boolean {
  for (const entity of Object.values(feature.entities)) {
    for (const field of Object.values(entity.fields)) {
      if (field.access?.read?.length || field.access?.write?.length) {
        return true;
      }
    }
  }
  return false;
}
