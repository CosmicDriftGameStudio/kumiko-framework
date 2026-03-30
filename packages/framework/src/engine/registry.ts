import type {
  EntityDefinition,
  FeatureDefinition,
  QueryHandlerDef,
  Registry,
  TranslationKeys,
  WriteHandlerDef,
} from "./types";

export function createRegistry(features: readonly FeatureDefinition[]): Registry {
  const featureMap = new Map<string, FeatureDefinition>();
  const entityMap = new Map<string, EntityDefinition>();
  const writeHandlerMap = new Map<string, WriteHandlerDef>();
  const queryHandlerMap = new Map<string, QueryHandlerDef>();
  let mergedTranslations: TranslationKeys = {};

  for (const feature of features) {
    if (featureMap.has(feature.name)) {
      throw new Error(`Duplicate feature: "${feature.name}"`);
    }
    featureMap.set(feature.name, feature);

    for (const [name, entity] of Object.entries(feature.entities)) {
      if (entityMap.has(name)) {
        throw new Error(`Duplicate entity: "${name}" (registered by multiple features)`);
      }
      entityMap.set(name, entity);
    }

    for (const [name, handler] of Object.entries(feature.writeHandlers)) {
      if (writeHandlerMap.has(name)) {
        throw new Error(`Duplicate write handler: "${name}" (registered by multiple features)`);
      }
      writeHandlerMap.set(name, handler);
    }

    for (const [name, handler] of Object.entries(feature.queryHandlers)) {
      if (queryHandlerMap.has(name)) {
        throw new Error(`Duplicate query handler: "${name}" (registered by multiple features)`);
      }
      queryHandlerMap.set(name, handler);
    }

    mergedTranslations = { ...mergedTranslations, ...feature.translations };
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

    getAllTranslations(): TranslationKeys {
      return mergedTranslations;
    },
  };
}
