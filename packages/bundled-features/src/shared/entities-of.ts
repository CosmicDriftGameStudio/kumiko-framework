import type { EntityDefinition, FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

// r.entity(...) is not the only way a feature exposes an entity shape:
// r.projection(...) can carry an optional `entity` too (raw read-models with
// no executor, e.g. billing-foundation's subscription table). Boot-check
// gates need every entity a feature declares, not just the r.entity ones, or
// a pii/tenantOwned/userOwned field on a projection-only entity is invisible
// to the guard it was annotated for.
export function entitiesOf(
  feature: FeatureDefinition,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  const fromEntities = Object.entries(feature.entities ?? {});
  const fromProjections = Object.values(feature.projections ?? {})
    .filter((p): p is typeof p & { entity: EntityDefinition } => p.entity !== undefined)
    .map((p) => [p.name, p.entity] as const);
  return [...fromEntities, ...fromProjections];
}
