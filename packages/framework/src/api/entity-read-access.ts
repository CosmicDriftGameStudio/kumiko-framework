import type { AccessRule, Registry } from "../engine/types/index.ts";

// Access rules of the query handlers that let a role read an entity (the
// handler's own entity or one it declares via liveEntities). A live signal
// carries the id of every row of the entity, so a signed-in connection gets it
// only when one of these rules grants its roles. An aggregate type without a
// reading query has no entry and is never put on the tenant channel.
function toKebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function collectEntityReadAccess(
  registry: Registry,
): ReadonlyMap<string, readonly AccessRule[]> {
  const rulesByEntity = new Map<string, AccessRule[]>();
  for (const [handlerName, handler] of registry.getAllQueryHandlers()) {
    const entities = new Set(handler.liveEntities ?? []);
    const ownEntity = registry.getHandlerEntity(handlerName);
    if (ownEntity !== undefined) entities.add(ownEntity);
    for (const entityName of entities) {
      // Executors may write under the kebab-case form of the camelCase r.entity() name
      // (document-extract for documentExtract); the signal carries that aggregate type.
      for (const aggregateType of new Set([entityName, toKebabCase(entityName)])) {
        const rules = rulesByEntity.get(aggregateType) ?? [];
        rules.push(handler.access);
        rulesByEntity.set(aggregateType, rules);
      }
    }
  }
  return rulesByEntity;
}
