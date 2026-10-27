import type { Registry } from "../engine/types/index.ts";

const cache = new WeakMap<Registry, ReadonlySet<string>>();

// Event-sourced read models (projection entities) are not in getAllEntities, so both sources count.
export function collectRecordOnlyFileEntityTypes(registry: Registry): ReadonlySet<string> {
  const cached = cache.get(registry);
  if (cached) return cached;
  const entityTypes = new Set<string>();
  for (const [name, entity] of registry.getAllEntities()) {
    if (entity.attachedFileAccess === "record-only") entityTypes.add(name);
  }
  for (const projection of registry.getAllProjections().values()) {
    const name = projection.source;
    if (typeof name !== "string") continue;
    if (registry.getReadModelEntity(name)?.attachedFileAccess === "record-only") {
      entityTypes.add(name);
    }
  }
  cache.set(registry, entityTypes);
  return entityTypes;
}
