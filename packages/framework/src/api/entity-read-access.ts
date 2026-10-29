import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";
import { toKebab } from "@cosmicdrift/kumiko-types/kebab-case";
import type { OwnershipMap } from "@cosmicdrift/kumiko-types/ownership";
import type { Registry } from "../engine/types/index.ts";

// Both collectors key by the entity name and its kebab-case form, so two registered names that
// fold to the same key (billing.period / billingPeriod) would merge their rules or overwrite each
// other's row maps: fail at boot instead of leaking or hiding signals.
export function assertNoAggregateTypeKeyCollisions(registry: Registry): void {
  const nameByKey = new Map<string, string>();
  for (const entityName of registry.getAllEntities().keys()) {
    for (const key of new Set([entityName, toKebab(entityName)])) {
      const other = nameByKey.get(key);
      if (other !== undefined && other !== entityName) {
        throw new Error(
          `Entities "${other}" and "${entityName}" map to the same live-signal aggregate type "${key}"; rename one of them.`,
        );
      }
      nameByKey.set(key, entityName);
    }
  }
}

// Only the "<entity>:detail" handler counts: other "<entity>:...:detail"
// queries map to the same entity but may return a different shape or scope.
// Entity names are globally unique and only the owning feature maps handlers
// to its entity, so at most one QN matches per entity.
function isEntityDetailQuery(qn: string, entityName: string): boolean {
  return qn.endsWith(`:query:${toKebab(entityName)}:detail`);
}

export function collectEntityDetailQueries(registry: Registry): ReadonlyMap<string, string> {
  const detailQueryByEntity = new Map<string, string>();
  for (const qn of registry.getAllQueryHandlers().keys()) {
    const entityName = registry.getHandlerEntity(qn);
    if (entityName !== undefined && isEntityDetailQuery(qn, entityName)) {
      detailQueryByEntity.set(entityName, qn);
    }
  }
  for (const projection of registry.getAllProjections().values()) {
    const entityName = projection.source;
    if (typeof entityName !== "string") continue;
    const owner = registry.getReadModelEntityOwner(entityName);
    if (owner === undefined) continue;
    const qn = `${owner}:query:${toKebab(entityName)}:detail`;
    if (registry.getAllQueryHandlers().has(qn)) detailQueryByEntity.set(entityName, qn);
  }
  return detailQueryByEntity;
}

// The access rule of each entity's own detail query. The file route and the read gate both ask
// "may this viewer open the record?" through this one rule, so a liveEntities or openToAll query
// that merely names an entity never widens what a gated row exposes.
export function collectEntityDetailAccess(registry: Registry): ReadonlyMap<string, AccessRule> {
  const handlers = registry.getAllQueryHandlers();
  const accessByEntity = new Map<string, AccessRule>();
  for (const [entityName, qn] of collectEntityDetailQueries(registry)) {
    const handler = handlers.get(qn);
    if (handler !== undefined) accessByEntity.set(entityName, handler.access);
  }
  return accessByEntity;
}

// Access rules of the query handlers that let a role read an entity (the
// handler's own entity or one it declares via liveEntities). A live signal
// carries the id of every row of the entity, so a signed-in connection gets it
// only when one of these rules grants its roles. An aggregate type without a
// reading query has no entry and is never put on the tenant channel.
export function collectEntityReadAccess(
  registry: Registry,
): ReadonlyMap<string, readonly AccessRule[]> {
  assertNoAggregateTypeKeyCollisions(registry);
  const rulesByEntity = new Map<string, AccessRule[]>();
  for (const [handlerName, handler] of registry.getAllQueryHandlers()) {
    const entities = new Set(handler.liveEntities ?? []);
    const ownEntity = registry.getHandlerEntity(handlerName);
    if (ownEntity !== undefined) entities.add(ownEntity);
    for (const entityName of entities) {
      // Executors may write under the kebab-case form of the camelCase r.entity() name
      // (document-extract for documentExtract); the signal carries that aggregate type.
      for (const aggregateType of new Set([entityName, toKebab(entityName)])) {
        const rules = rulesByEntity.get(aggregateType) ?? [];
        rules.push(handler.access);
        rulesByEntity.set(aggregateType, rules);
      }
    }
  }
  return rulesByEntity;
}

// Entities whose own access.read narrows rows per role (e.g. Driver sees only assigned rows).
// A signal for such an entity must not name ids to a role that does not read every row.
export function collectEntityRowReadMaps(registry: Registry): ReadonlyMap<string, OwnershipMap> {
  assertNoAggregateTypeKeyCollisions(registry);
  const mapsByEntity = new Map<string, OwnershipMap>();
  for (const [entityName, entity] of registry.getAllEntities()) {
    // A read gate narrows rows for every role, so no role reads every row: signals stay anonymous.
    const readMap = entity.readGate !== undefined ? {} : entity.access?.read;
    if (readMap === undefined) continue;
    if (entity.readGate === undefined && Object.keys(readMap).length === 0) continue;
    for (const aggregateType of new Set([entityName, toKebab(entityName)])) {
      mapsByEntity.set(aggregateType, readMap);
    }
  }
  return mapsByEntity;
}
