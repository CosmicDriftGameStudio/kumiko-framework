import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { isReadRestrictedField } from "../field-access.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";

// Entities that explicit projections carry for a source the feature does not register as r.entity.
export function readModelEntitiesOf(
  feature: FeatureDefinition,
): ReadonlyArray<readonly [string, EntityDefinition]> {
  return Object.values(feature.projections ?? {}).flatMap((projection) =>
    !projection.isImplicit &&
    projection.entity !== undefined &&
    typeof projection.source === "string" &&
    feature.entities?.[projection.source] === undefined
      ? [[projection.source, projection.entity] as const]
      : [],
  );
}

function restrictedSubFieldOf(field: FieldDefinition): string | undefined {
  if (field.type !== "embedded") return undefined;
  return Object.entries(field.schema).find(([, sub]) => sub.access?.read !== undefined)?.[0];
}

// Dispatch strips unreadable fields only through the r.entity a handler belongs to. Any other
// entity a projection carries (array source, a separate entity over an r.entity's stream, a
// read model) comes back from hand-written queries, so a field rule there would never apply.
export function validateReadModelFieldReadRules(feature: FeatureDefinition): void {
  for (const projection of Object.values(feature.projections ?? {})) {
    const { entity, source } = projection;
    if (projection.isImplicit || entity === undefined) continue;
    // r.entity stores a copy without backingTable, so the shared fields map marks the same entity.
    if (typeof source === "string" && feature.entities?.[source]?.fields === entity.fields) {
      continue;
    }
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (!isReadRestrictedField(field)) continue;
      const subField = restrictedSubFieldOf(field);
      const fieldLabel =
        subField === undefined
          ? `field "${fieldName}"`
          : `field "${fieldName}" sub-field "${subField}"`;
      throw bootRuleError(ENTITY_DECLARATION_RULES.readModelFieldReadRule, {
        message: `[Feature ${feature.name}] read-model entity "${entity.name}" ${fieldLabel} has a read rule (access.read, writeOnly or a sub-field access.read), declared on projection "${projection.name}". Read-model queries return rows unfiltered, so the rule would never apply. Restrict the query's access instead, or keep the field on an r.entity whose queries the framework filters.`,
      });
    }
  }
}
