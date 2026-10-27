import type { RegistryState } from "./registry-state.ts";

// Explicit projections that carry an entity make that entity addressable by file
// bindings and the file read check, keyed by the source aggregate type. They stay out of
// entityMap on purpose: CRUD, preSave, write checks and soft-delete cleanup hang off it.
export function populateReadModelEntities(state: RegistryState): void {
  const registeredBy = new Map<string, string>();
  for (const [qualifiedName, projection] of state.projectionMap) {
    const { entity, source } = projection;
    if (projection.isImplicit || entity === undefined || typeof source !== "string") continue;
    if (state.entityMap.has(source)) continue;
    const previous = registeredBy.get(source);
    if (previous !== undefined) {
      throw new Error(
        `Read-model entity "${source}" is declared by two projections ("${previous}" and ` +
          `"${qualifiedName}"). File bindings address the entity by its source, so each ` +
          "source may carry an entity in one projection only.",
      );
    }
    registeredBy.set(source, qualifiedName);
    state.readModelEntityMap.set(source, {
      entity,
      featureName: qualifiedName.split(":")[0] ?? qualifiedName,
    });
  }
}
