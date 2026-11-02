import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { QueryHandlerDef, WriteHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import {
  ENTITY_CONVENTION_QUERY_BRAND,
  ENTITY_CONVENTION_WRITE_BRAND,
} from "@cosmicdrift/kumiko-types/handlers";
import { findEntity } from "../find-entity.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";

// --- Parent-ref boot validation ---
//
// Join-row entities (EntityDefinition.parentRef) derive both the write-path
// deny and the read-path SQL gate from one declaration. This is the boot-time
// half of the fail-closed guarantee: the read gate itself (db/parent-ref-
// clause.ts) passes an ungated query through when no ParentVisibilityOption
// was supplied — throwing there would 500 every custom handler and
// framework-internal detail() call that doesn't wire it, so the enforcement
// has to happen loudly here instead, once, at boot.

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

function findWriteHandler(
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  handlerName: string,
): WriteHandlerDef | undefined {
  for (const f of featureMap.values()) {
    const handler = f.writeHandlers[handlerName];
    if (handler) return handler;
  }
  return undefined;
}

type ParentRef = NonNullable<EntityDefinition["parentRef"]>;

function assertParentRefFields(
  feature: FeatureDefinition,
  entityName: string,
  entity: EntityDefinition,
  parentRef: ParentRef,
): void {
  if (entity.fields[parentRef.entityTypeField] === undefined) {
    throw bootRuleError(ENTITY_DECLARATION_RULES.parentRefTypeFieldUnknown, {
      message:
        `[Kumiko ParentRef] entity "${entityName}".parentRef.entityTypeField references ` +
        `"${parentRef.entityTypeField}" — which is not a declared field on "${entityName}" ` +
        `(feature: "${feature.name}"). Fix: point entityTypeField at a real field on the entity.`,
    });
  }
  if (entity.fields[parentRef.entityIdField] === undefined) {
    throw bootRuleError(ENTITY_DECLARATION_RULES.parentRefIdFieldUnknown, {
      message:
        `[Kumiko ParentRef] entity "${entityName}".parentRef.entityIdField references ` +
        `"${parentRef.entityIdField}" — which is not a declared field on "${entityName}" ` +
        `(feature: "${feature.name}"). Fix: point entityIdField at a real field on the entity.`,
    });
  }
}

function assertAllowedTypeHosts(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
  parentRef: ParentRef,
): void {
  for (const hostName of parentRef.allowedTypes ?? []) {
    const host = findEntity(featureMap, hostName);
    if (host === undefined) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.parentRefAllowedTypeUnregistered, {
        message:
          `[Kumiko ParentRef] entity "${entityName}".parentRef.allowedTypes names "${hostName}" ` +
          `— no entity with that name is registered in this feature set (feature: ` +
          `"${feature.name}"). Fix: remove "${hostName}" from allowedTypes, or register it.`,
      });
    }
    if (host.parentRef !== undefined) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.parentRefAllowedTypeHasParentRef, {
        message:
          `[Kumiko ParentRef] entity "${entityName}".parentRef.allowedTypes names "${hostName}" ` +
          `— which itself declares a parentRef (feature: "${feature.name}"). A join-row ` +
          `entity can't act as a host for another join-row entity (no recursive gating). ` +
          `Fix: remove "${hostName}" from allowedTypes, or drop its own parentRef.`,
      });
    }
  }
}

function assertConventionQueryHandlers(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): void {
  for (const verb of ["list", "detail"] as const) {
    const handlerName = `${entityName}:${verb}`;
    const handler = findQueryHandler(featureMap, handlerName);
    // skip: no handler registered for this verb — nothing to brand-check
    if (handler === undefined) continue;
    if (handler[ENTITY_CONVENTION_QUERY_BRAND] !== true) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.parentRefHandWrittenQuery, {
        message:
          `[Kumiko ParentRef] query handler "${handlerName}" does not carry ` +
          `ENTITY_CONVENTION_QUERY_BRAND, but entity "${entityName}" declares a parentRef ` +
          `(feature: "${feature.name}"). A hand-written handler bypasses the parent-ref ` +
          `read-gate unless it explicitly wires parentVisibility. Fix: register "${handlerName}" ` +
          `via defineEntityListHandler/defineEntityDetailHandler (or defineEntityQueryHandler), ` +
          `or pass { parentVisibility: { entities: ctx.registry.getAllEntities() } } to ` +
          `executor.${verb} yourself.`,
      });
    }
  }
}

function assertConventionWriteHandlers(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): void {
  for (const verb of ["update", "delete", "restore"] as const) {
    const handlerName = `${entityName}:${verb}`;
    const handler = findWriteHandler(featureMap, handlerName);
    // skip: no handler registered for this verb — nothing to brand-check
    if (handler === undefined) continue;
    if (handler[ENTITY_CONVENTION_WRITE_BRAND] !== true) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.parentRefHandWrittenWrite, {
        message:
          `[Kumiko ParentRef] write handler "${handlerName}" does not carry ` +
          `ENTITY_CONVENTION_WRITE_BRAND, but entity "${entityName}" declares a parentRef ` +
          `(feature: "${feature.name}"). A hand-written handler bypasses the parent visibility ` +
          `gate unless it explicitly wires parentVisibility. Fix: register "${handlerName}" ` +
          `via defineEntityWriteHandler, or pass parentVisibility: ` +
          `parentVisibilityFor(ctx, event.user) to executor.${verb} yourself.`,
      });
    }
  }
}

export function validateParentRefs(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const parentRef = entity.parentRef;
    if (parentRef === undefined) continue;
    assertParentRefFields(feature, entityName, entity, parentRef);
    assertAllowedTypeHosts(feature, featureMap, entityName, parentRef);
    assertConventionQueryHandlers(feature, featureMap, entityName);
    assertConventionWriteHandlers(feature, featureMap, entityName);
  }
}
