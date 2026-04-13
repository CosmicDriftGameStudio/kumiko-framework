import type {
  ConfigKeyDefinition,
  EntityDefinition,
  EntityRelations,
  EventDef,
  FeatureDefinition,
  JobDefinition,
  NotificationDefinition,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  QueryHandlerDef,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  Registry,
  RelationDefinition,
  TranslationKeys,
  WriteHandlerDef,
} from "./types";
import { resolveName } from "./types/handlers";

type IncomingRelation = {
  sourceEntity: string;
  relationName: string;
  relation: RelationDefinition;
};

export function createRegistry(features: readonly FeatureDefinition[]): Registry {
  const featureMap = new Map<string, FeatureDefinition>();
  const entityMap = new Map<string, EntityDefinition>();
  const relationMap = new Map<string, Record<string, RelationDefinition>>();
  const writeHandlerMap = new Map<string, WriteHandlerDef>();
  const queryHandlerMap = new Map<string, QueryHandlerDef>();
  const preSaveHooks = new Map<string, PreSaveHookFn[]>();
  const postSaveHooks = new Map<string, PostSaveHookFn[]>();
  const preDeleteHooks = new Map<string, PreDeleteHookFn[]>();
  const postDeleteHooks = new Map<string, PostDeleteHookFn[]>();
  const preQueryHooks = new Map<string, PreQueryHookFn[]>();
  // Entity hooks — keyed by entity name, NOT prefixed
  const entityPostSaveHooks = new Map<string, PostSaveHookFn[]>();
  const entityPreDeleteHooks = new Map<string, PreDeleteHookFn[]>();
  const entityPostDeleteHooks = new Map<string, PostDeleteHookFn[]>();
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

  // Prefix helper: featureName.name
  function qualify(featureName: string, name: string): string {
    return `${featureName}.${name}`;
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

  // Merge hooks with feature prefix (handler hooks)
  function mergeHookListQualified<T>(
    map: Map<string, T[]>,
    source: Readonly<Record<string, readonly T[]>>,
    featureName: string,
  ): void {
    for (const [name, fns] of Object.entries(source)) {
      const qualified = qualify(featureName, name);
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

    // Write handlers: featureName.handlerName
    for (const [name, handler] of Object.entries(feature.writeHandlers)) {
      const qualified = qualify(feature.name, name);
      if (writeHandlerMap.has(qualified)) {
        throw new Error(
          `Duplicate write handler: "${qualified}" (registered by multiple features)`,
        );
      }
      writeHandlerMap.set(qualified, { ...handler, name: qualified });
      handlerFeatureMap.set(qualified, feature.name);
    }

    // Query handlers: featureName.handlerName
    for (const [name, handler] of Object.entries(feature.queryHandlers)) {
      const qualified = qualify(feature.name, name);
      if (queryHandlerMap.has(qualified)) {
        throw new Error(
          `Duplicate query handler: "${qualified}" (registered by multiple features)`,
        );
      }
      queryHandlerMap.set(qualified, { ...handler, name: qualified });
      handlerFeatureMap.set(qualified, feature.name);
    }

    // Config keys: featureName.key (already prefixed before this change)
    for (const [key, keyDef] of Object.entries(feature.configKeys)) {
      const qualifiedKey = qualify(feature.name, key);
      if (configKeyMap.has(qualifiedKey)) {
        throw new Error(
          `Duplicate config key: "${qualifiedKey}" (registered by multiple features)`,
        );
      }
      configKeyMap.set(qualifiedKey, keyDef);
    }

    // Jobs: featureName.jobName (already prefixed before this change)
    for (const [name, jobDef] of Object.entries(feature.jobs)) {
      const qualifiedName = qualify(feature.name, name);
      if (jobMap.has(qualifiedName)) {
        throw new Error(`Duplicate job: "${qualifiedName}" (registered by multiple features)`);
      }
      jobMap.set(qualifiedName, { ...jobDef, name: qualifiedName });
    }

    // Notifications: collect with raw trigger — resolved after all features are registered
    for (const [name, notifDef] of Object.entries(feature.notifications)) {
      const qualifiedName = qualify(feature.name, name);
      notificationMap.set(qualifiedName, {
        ...notifDef,
        name: qualifiedName,
        trigger: { on: notifDef.trigger.on },
      });
      notificationFeatureMap.set(qualifiedName, feature.name);
    }

    // Events: featureName.eventName
    for (const [eventName, eventDef] of Object.entries(feature.events)) {
      const qualified = qualify(feature.name, eventName);
      eventMap.set(qualified, { ...eventDef, name: qualified });
    }

    // Translations prefixed with featureName: (i18next namespace convention)
    for (const [key, value] of Object.entries(feature.translations)) {
      mergedTranslations[`${feature.name}:${key}`] = value;
    }

    // Lifecycle hooks: handler-based, qualified with feature prefix
    mergeHookListQualified(preSaveHooks, feature.hooks.preSave, feature.name);
    mergeHookListQualified(postSaveHooks, feature.hooks.postSave, feature.name);
    mergeHookListQualified(preDeleteHooks, feature.hooks.preDelete, feature.name);
    mergeHookListQualified(postDeleteHooks, feature.hooks.postDelete, feature.name);
    mergeHookListQualified(preQueryHooks, feature.hooks.preQuery, feature.name);

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

    // Extension hooks → entity hooks (fire for all writes on the entity)
    if (ext.hooks) {
      if (ext.hooks.postSave) {
        const existing = entityPostSaveHooks.get(usage.entityName) ?? [];
        existing.push(ext.hooks.postSave);
        entityPostSaveHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.preDelete) {
        const existing = entityPreDeleteHooks.get(usage.entityName) ?? [];
        existing.push(ext.hooks.preDelete);
        entityPreDeleteHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.postDelete) {
        const existing = entityPostDeleteHooks.get(usage.entityName) ?? [];
        existing.push(ext.hooks.postDelete);
        entityPostDeleteHooks.set(usage.entityName, existing);
      }
      // preSave on extensions: store as handler hook for all CRUD handlers of this entity
      if (ext.hooks.preSave) {
        // Find all write handlers that belong to this entity
        for (const qualifiedHandler of writeHandlerMap.keys()) {
          const dotIdx = qualifiedHandler.indexOf(".");
          if (dotIdx < 0) continue;
          const handlerName = qualifiedHandler.slice(dotIdx + 1);
          const entityDot = handlerName.indexOf(".");
          if (entityDot < 0) continue;
          const candidate = handlerName.slice(0, entityDot);
          if (candidate === usage.entityName) {
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

  // Build handler → entity mapping: "users.user.create" → "user"
  // Convention: handler name starts with entity name (from r.crud())
  for (const qualifiedHandler of [...writeHandlerMap.keys(), ...queryHandlerMap.keys()]) {
    // qualifiedHandler = "featureName.handlerName" where handlerName might be "entityName.action"
    const dotIdx = qualifiedHandler.indexOf(".");
    if (dotIdx < 0) continue;
    const handlerName = qualifiedHandler.slice(dotIdx + 1); // e.g. "user.create"
    const entityDot = handlerName.indexOf(".");
    if (entityDot < 0) continue;
    const candidateEntity = handlerName.slice(0, entityDot); // e.g. "user"
    if (entityMap.has(candidateEntity)) {
      handlerEntityMap.set(qualifiedHandler, candidateEntity);
    }
  }

  // Validate: handlers in features with field-access rules must be entity-mapped.
  // Without entity mapping, field-level access checks are silently skipped (security gap).
  // Convention: "entityName.action" = entity-bound (must resolve), "action" = standalone (no filter).
  for (const feature of features) {
    if (!hasFieldAccessRules(feature)) continue;

    // Write handlers: ALL must be entity-mapped (security-critical, writes need field-access checks)
    for (const handlerName of Object.keys(feature.writeHandlers)) {
      const qualified = qualify(feature.name, handlerName);
      if (!handlerEntityMap.has(qualified)) {
        throw new Error(
          `Write handler "${qualified}" is not mapped to any entity, but feature "${feature.name}" has field-level access rules. ` +
            `Name must follow "entityName.action" convention (e.g. "user.create") so field-access checks apply.`,
        );
      }
    }

    // Query handlers: only those with a dot must resolve (typo protection).
    // No dot = standalone query (dashboard, stats) — intentionally not entity-bound.
    for (const handlerName of Object.keys(feature.queryHandlers)) {
      if (!handlerName.includes(".")) continue;
      const qualified = qualify(feature.name, handlerName);
      if (!handlerEntityMap.has(qualified)) {
        const entityGuess = handlerName.slice(0, handlerName.indexOf("."));
        throw new Error(
          `Query handler "${qualified}" looks entity-bound ("${entityGuess}.…") but entity "${entityGuess}" does not exist. ` +
            `Either fix the entity name, or remove the dot to mark it as a standalone query (e.g. "dashboard" instead of "dashboard.list").`,
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
    const featureName = notificationFeatureMap.get(qualifiedName)!;
    // Try as-is first (cross-feature fully qualified), then qualify with own feature name
    let triggerOn: string;
    if (allHandlerNames.has(notifDef.trigger.on)) {
      triggerOn = notifDef.trigger.on;
    } else {
      triggerOn = qualify(featureName, notifDef.trigger.on);
      if (!allHandlerNames.has(triggerOn)) {
        throw new Error(
          `Notification "${qualifiedName}" triggers on "${notifDef.trigger.on}" ` +
            `but no handler with that name exists. ` +
            `Tried: "${notifDef.trigger.on}" and "${triggerOn}"`,
        );
      }
    }
    // Update the stored definition with resolved trigger
    notificationMap.set(qualifiedName, { ...notifDef, trigger: { on: triggerOn } });

    if (!postSaveHooks.has(triggerOn)) postSaveHooks.set(triggerOn, []);
    postSaveHooks.get(triggerOn)?.push(async (result, context) => {
      if (!context.notify) return;
      const to = notifDef.recipient(result);
      if (to === null) return;
      const data = notifDef.data(result);
      await context.notify(qualifiedName, { to, data });
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
      const eventName = resolveName(jobDef.trigger.on);
      if (!allHandlers.has(eventName)) {
        throw new Error(
          `Job "${jobName}" triggers on "${eventName}" but no handler with that name exists`,
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

    getPostSaveHooks(name: string): readonly PostSaveHookFn[] {
      return postSaveHooks.get(name) ?? [];
    },

    getPreDeleteHooks(name: string): readonly PreDeleteHookFn[] {
      return preDeleteHooks.get(name) ?? [];
    },

    getPostDeleteHooks(name: string): readonly PostDeleteHookFn[] {
      return postDeleteHooks.get(name) ?? [];
    },

    getPreQueryHooks(name: string): readonly PreQueryHookFn[] {
      return preQueryHooks.get(name) ?? [];
    },

    // Entity hooks — fire for all writes on an entity
    getEntityPostSaveHooks(entityName: string): readonly PostSaveHookFn[] {
      return entityPostSaveHooks.get(entityName) ?? [];
    },

    getEntityPreDeleteHooks(entityName: string): readonly PreDeleteHookFn[] {
      return entityPreDeleteHooks.get(entityName) ?? [];
    },

    getEntityPostDeleteHooks(entityName: string): readonly PostDeleteHookFn[] {
      return entityPostDeleteHooks.get(entityName) ?? [];
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
