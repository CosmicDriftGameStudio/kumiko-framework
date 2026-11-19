import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import { holdsFileRefs, isFileSubField } from "../../files/file-field-slots.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";
import { carriesOwnSourceEntity } from "./read-model-field-access.ts";

function hasReadRuleOnItsFiles(field: FieldDefinition): boolean {
  if (!holdsFileRefs(field)) return false;
  if (field.access?.read !== undefined) return true;
  return (
    field.type === "embedded" &&
    Object.values(field.schema).some((sub) => isFileSubField(sub) && sub.access?.read !== undefined)
  );
}

// The runtime looks a declaration up by entity type: an r.entity, or a read model keyed by its one
// source stream when no r.entity of the app registers that stream (getReadModelEntity).
function projectionDeclarationsOf(
  feature: FeatureDefinition,
  registeredEntityNames: ReadonlySet<string>,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  return Object.values(feature.projections ?? {}).flatMap((projection) => {
    const { entity, source } = projection;
    if (projection.isImplicit || entity?.crossTenantFileRead === undefined) return [];
    if (carriesOwnSourceEntity(feature, projection)) return [];
    if (typeof source !== "string" || registeredEntityNames.has(source)) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.crossTenantFileReadUnseenProjectionEntity, {
        message: `[Feature ${feature.name}] projection "${projection.name}" entity "${entity.name}" declares crossTenantFileRead, but the file check never sees it: it finds read models only by a single source stream that no r.entity registers (source: ${JSON.stringify(source)}).`,
      });
    }
    return [[source, entity] as const];
  });
}

export function validateCrossTenantFileRead(
  feature: FeatureDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
  registeredEntityNames: ReadonlySet<string>,
): void {
  const entries = [
    ...Object.entries(feature.entities ?? {}),
    ...projectionDeclarationsOf(feature, registeredEntityNames),
  ];
  for (const [entityName, entity] of entries) {
    const declaration = entity.crossTenantFileRead;
    if (declaration === undefined) continue;
    if (declaration.reason.trim().length === 0) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.crossTenantFileReadReasonMissing, {
        message: `[Feature ${feature.name}] entity "${entityName}" declares crossTenantFileRead without a reason; state why its files are readable across tenants.`,
      });
    }
    if (!queryHandlers.has(declaration.query)) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.crossTenantFileReadQueryUnregistered, {
        message: `[Feature ${feature.name}] entity "${entityName}" declares crossTenantFileRead.query "${declaration.query}" which is not a registered query-handler. Check the QN spelling (expected "<feature>:query:<short>") and that the handler is declared via r.queryHandler(...).`,
      });
    }
    assertCrossTenantFilesCarryNoReadRule(feature.name, entityName, entity);
  }
}

// Also run by the registry on entities with their extendSchema fields merged in.
export function assertCrossTenantFilesCarryNoReadRule(
  featureName: string,
  entityName: string,
  entity: EntityDefinition,
): void {
  if (entity.crossTenantFileRead === undefined) return;
  const restrictedFileField = Object.entries(entity.fields).find(([, field]) =>
    hasReadRuleOnItsFiles(field),
  );
  if (restrictedFileField !== undefined) {
    throw bootRuleError(ENTITY_DECLARATION_RULES.crossTenantFileReadRestrictedField, {
      message: `[Feature ${featureName}] entity "${entityName}" declares crossTenantFileRead, but its file field "${restrictedFileField[0]}" (or one of its file sub-fields) has an access.read rule; a reader from another tenant would get the file without passing that rule.`,
    });
  }
}
