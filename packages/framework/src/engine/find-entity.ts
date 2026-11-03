import type { EntityDefinition } from "./types/fields.ts";
import type { FeatureDefinition } from "./types/index.ts";

export function findEntity(
  features: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): EntityDefinition | undefined {
  for (const feature of features.values()) {
    const entities = feature.entities;
    if (entities && Object.hasOwn(entities, entityName)) return entities[entityName];
  }
  return undefined;
}
