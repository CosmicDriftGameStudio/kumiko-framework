import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import type { EntityDefinition, FeatureDefinition, QueryHandlerDef } from "../types";

// --- Parent-ref boot validation (fw#2766) ---
//
// Join-row entities (EntityDefinition.parentRef) derive both the write-path
// deny and the read-path SQL gate from one declaration. This is the boot-time
// half of the fail-closed guarantee: the read gate itself (db/parent-ref-
// clause.ts) passes an ungated query through when no ParentVisibilityOption
// was supplied — throwing there would 500 every custom handler and
// framework-internal detail() call that doesn't wire it, so the enforcement
// has to happen loudly here instead, once, at boot.

function findEntity(
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): EntityDefinition | undefined {
  for (const f of featureMap.values()) {
    const entity = f.entities?.[entityName];
    if (entity) return entity;
  }
  return undefined;
}

function findQueryHandler(
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  handlerName: string,
): QueryHandlerDef | undefined {
  for (const f of featureMap.values()) {
    const handler = f.queryHandlers[handlerName];
    if (handler) return handler;
  }
  return undefined;
}

export function validateParentRefs(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const parentRef = entity.parentRef;
    if (parentRef === undefined) continue;

    if (entity.fields[parentRef.entityTypeField] === undefined) {
      throw new Error(
        `[Kumiko ParentRef] entity "${entityName}".parentRef.entityTypeField references ` +
          `"${parentRef.entityTypeField}" — which is not a declared field on "${entityName}" ` +
          `(feature: "${feature.name}"). Fix: point entityTypeField at a real field on the entity.`,
      );
    }
    if (entity.fields[parentRef.entityIdField] === undefined) {
      throw new Error(
        `[Kumiko ParentRef] entity "${entityName}".parentRef.entityIdField references ` +
          `"${parentRef.entityIdField}" — which is not a declared field on "${entityName}" ` +
          `(feature: "${feature.name}"). Fix: point entityIdField at a real field on the entity.`,
      );
    }

    for (const hostName of parentRef.allowedTypes ?? []) {
      const host = findEntity(featureMap, hostName);
      if (host === undefined) {
        throw new Error(
          `[Kumiko ParentRef] entity "${entityName}".parentRef.allowedTypes names "${hostName}" ` +
            `— no entity with that name is registered in this feature set (feature: ` +
            `"${feature.name}"). Fix: remove "${hostName}" from allowedTypes, or register it.`,
        );
      }
      if (host.parentRef !== undefined) {
        throw new Error(
          `[Kumiko ParentRef] entity "${entityName}".parentRef.allowedTypes names "${hostName}" ` +
            `— which itself declares a parentRef (feature: "${feature.name}"). A join-row ` +
            `entity can't act as a host for another join-row entity (no recursive gating). ` +
            `Fix: remove "${hostName}" from allowedTypes, or drop its own parentRef.`,
        );
      }
    }

    for (const verb of ["list", "detail"] as const) {
      const handlerName = `${entityName}:${verb}`;
      const handler = findQueryHandler(featureMap, handlerName);
      // skip: no handler registered for this verb — nothing to brand-check
      if (handler === undefined) continue;
      if (handler[ENTITY_CONVENTION_QUERY_BRAND] !== true) {
        throw new Error(
          `[Kumiko ParentRef] query handler "${handlerName}" does not carry ` +
            `ENTITY_CONVENTION_QUERY_BRAND, but entity "${entityName}" declares a parentRef ` +
            `(feature: "${feature.name}"). A hand-written handler bypasses the parent-ref ` +
            `read-gate unless it explicitly wires parentVisibility. Fix: register "${handlerName}" ` +
            `via defineEntityListHandler/defineEntityDetailHandler (or defineEntityQueryHandler), ` +
            `or pass { parentVisibility: { entities: ctx.registry.getAllEntities() } } to ` +
            `executor.${verb} yourself.`,
        );
      }
    }
  }
}
