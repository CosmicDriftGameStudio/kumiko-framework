import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_STRUCTURE_RULES } from "./entity-structure-rules.ts";

export function validateSortNulls(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (!("sortNulls" in field) || field.sortNulls === undefined) continue;
      if (field.sortable === true) continue;
      throw bootRuleError(ENTITY_STRUCTURE_RULES.sortNullsNeedsSortable, {
        message: `Field "${fieldName}" on entity "${entityName}" sets sortNulls without sortable: true; the null order only applies to a sortable field. Add sortable: true or drop sortNulls.`,
      });
    }
  }
}
