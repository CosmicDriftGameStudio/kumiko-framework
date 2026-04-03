import type {
  ConfigKeyDefinition,
  EntityDefinition,
  EntityRelations,
  EventDef,
  FeatureDefinition,
  JobDefinition,
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
  const configKeyMap = new Map<string, ConfigKeyDefinition>();
  const jobMap = new Map<string, JobDefinition>();
  const eventMap = new Map<string, EventDef>();
  const extensionMap = new Map<string, RegistrarExtensionDef>();
  const extensionUsages: RegistrarExtensionRegistration[] = [];
  const allReferenceData: ReferenceDataDef[] = [];
  let mergedTranslations: Record<string, Record<string, string>> = {};

  // Prefix helper: featureName.name
  function qualify(featureName: string, name: string): string {
    return `${featureName}.${name}`;
  }

  // Prefix lifecycle hooks with feature name
  function mergeHookListPrefixed<T>(
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

    // Entities: featureName.entityName
    for (const [name, entity] of Object.entries(feature.entities)) {
      const qualified = qualify(feature.name, name);
      if (entityMap.has(qualified)) {
        throw new Error(`Duplicate entity: "${qualified}" (registered by multiple features)`);
      }
      entityMap.set(qualified, entity);
    }

    // Relations: featureName.entityName → featureName.relName
    for (const [entityName, rels] of Object.entries(feature.relations)) {
      const qualifiedEntity = qualify(feature.name, entityName);
      const existing = relationMap.get(qualifiedEntity) ?? {};
      for (const [relName, relDef] of Object.entries(rels)) {
        if (existing[relName]) {
          throw new Error(
            `Duplicate relation: "${qualifiedEntity}.${relName}" (registered by multiple features)`,
          );
        }
        existing[relName] = relDef;
      }
      relationMap.set(qualifiedEntity, existing);
    }

    // Write handlers: featureName.handlerName
    for (const [name, handler] of Object.entries(feature.writeHandlers)) {
      const qualified = qualify(feature.name, name);
      if (writeHandlerMap.has(qualified)) {
        throw new Error(`Duplicate write handler: "${qualified}" (registered by multiple features)`);
      }
      writeHandlerMap.set(qualified, { ...handler, name: qualified });
    }

    // Query handlers: featureName.handlerName
    for (const [name, handler] of Object.entries(feature.queryHandlers)) {
      const qualified = qualify(feature.name, name);
      if (queryHandlerMap.has(qualified)) {
        throw new Error(`Duplicate query handler: "${qualified}" (registered by multiple features)`);
      }
      queryHandlerMap.set(qualified, { ...handler, name: qualified });
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

    // Events: featureName.eventName
    for (const [eventName, eventDef] of Object.entries(feature.events)) {
      const qualified = qualify(feature.name, eventName);
      eventMap.set(qualified, { ...eventDef, name: qualified });
    }

    // Translations prefixed with featureName: (i18next namespace convention)
    for (const [key, value] of Object.entries(feature.translations)) {
      mergedTranslations[`${feature.name}:${key}`] = value;
    }

    // Lifecycle hooks: prefixed with feature name
    mergeHookListPrefixed(preSaveHooks, feature.hooks.preSave, feature.name);
    mergeHookListPrefixed(postSaveHooks, feature.hooks.postSave, feature.name);
    mergeHookListPrefixed(preDeleteHooks, feature.hooks.preDelete, feature.name);
    mergeHookListPrefixed(postDeleteHooks, feature.hooks.postDelete, feature.name);
    mergeHookListPrefixed(preQueryHooks, feature.hooks.preQuery, feature.name);

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

  // Process extension usages: call onRegister for each usage
  for (const usage of extensionUsages) {
    const ext = extensionMap.get(usage.extensionName);
    if (ext?.onRegister) {
      ext.onRegister(usage.entityName, usage.options);
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
      const entity = entityMap.get(entityName);
      if (!entity) return [];
      return Object.entries(entity.fields)
        .filter(([, field]) => field.type === "text" && field.searchable === true)
        .map(([name]) => name);
    },

    getSortableFields(entityName: string): readonly string[] {
      const entity = entityMap.get(entityName);
      if (!entity) return [];
      return Object.entries(entity.fields)
        .filter(([, field]) => field.type === "text" && field.sortable === true)
        .map(([name]) => name);
    },

    getRelations(entityName: string): EntityRelations {
      return (relationMap.get(entityName) ?? {}) as EntityRelations;
    },

    getSearchIncludes(entityName: string): ReadonlyMap<string, readonly string[]> {
      const rels = relationMap.get(entityName) ?? {};
      const result = new Map<string, readonly string[]>();

      for (const [relName, rel] of Object.entries(rels)) {
        if (rel.type === "belongsTo" && rel.searchInclude && rel.searchInclude.length > 0) {
          result.set(relName, rel.searchInclude);
        }
        if (rel.type === "manyToMany" && rel.searchInclude && rel.searchInclude.length > 0) {
          result.set(relName, rel.searchInclude);
        }
      }

      return result;
    },

    getIncomingRelations(entityName: string): readonly IncomingRelation[] {
      const result: IncomingRelation[] = [];
      for (const [source, rels] of relationMap) {
        for (const [relName, rel] of Object.entries(rels)) {
          if (rel.target === entityName) {
            result.push({ sourceEntity: source, relationName: relName, relation: rel });
          }
        }
      }
      return result;
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

    getAllTranslations(): TranslationKeys {
      return mergedTranslations;
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

    getAllReferenceData(): readonly ReferenceDataDef[] {
      return allReferenceData;
    },
  };
}
