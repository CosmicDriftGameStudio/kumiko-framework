import type { Registry } from "./types/feature.ts";

export function projectQueryLiveEntities(
  registry: Registry,
  featureName: string,
): Readonly<Record<string, readonly string[]>> {
  const projected: Record<string, readonly string[]> = {};
  for (const [queryQn, handler] of registry.getAllQueryHandlers()) {
    if (registry.getHandlerFeature(queryQn) !== featureName) continue;
    // /api/schema is public to every client; a dispatchOnly QN there would confirm it exists.
    if (handler.dispatchOnly) continue;
    // The handler's own entity is implicit: the client cannot derive a camelCase
    // entity (driverNode) from the kebab QN segment, but SSE frames carry the entity name.
    const handlerEntity = registry.getHandlerEntity(queryQn);
    const entities = new Set(handler.liveEntities ?? []);
    if (handlerEntity !== undefined) entities.add(handlerEntity);
    if (entities.size === 0) continue;
    projected[queryQn] = [...entities];
  }
  return projected;
}
