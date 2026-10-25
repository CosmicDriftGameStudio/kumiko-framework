import type { Registry } from "./types/feature.ts";

export function projectQueryLiveEntities(
  registry: Registry,
  featureName: string,
): Readonly<Record<string, readonly string[]>> {
  const projected: Record<string, readonly string[]> = {};
  for (const [queryQn, handler] of registry.getAllQueryHandlers()) {
    if (handler.liveEntities === undefined || handler.liveEntities.length === 0) continue;
    if (registry.getHandlerFeature(queryQn) !== featureName) continue;
    projected[queryQn] = [...handler.liveEntities];
  }
  return projected;
}
