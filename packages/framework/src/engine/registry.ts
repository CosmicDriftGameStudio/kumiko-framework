import type {
  EntityDefinition,
  EntityRelations,
  FeatureDefinition,
  QueryHandlerDef,
  Registry,
  RelationDefinition,
  TranslationKeys,
  WriteHandlerDef,
} from "./types";

export function createRegistry(features: readonly FeatureDefinition[]): Registry {
  const featureMap = new Map<string, FeatureDefinition>();
  const entityMap = new Map<string, EntityDefinition>();
  const relationMap = new Map<string, Record<string, RelationDefinition>>();
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

    // Merge relations — multiple features can add relations to the same entity
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

    getAllTranslations(): TranslationKeys {
      return mergedTranslations;
    },
  };
}
