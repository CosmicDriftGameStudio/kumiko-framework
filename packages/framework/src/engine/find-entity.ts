import type { EntityDefinition } from "./types/fields.ts";
import type { FeatureDefinition } from "./types/index.ts";

export function findEntity(
  features: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): EntityDefinition | undefined {
  for (const feature of features.values()) {
    const entity = feature.entities?.[entityName];
    if (entity) return entity;
  }
  return undefined;
}
