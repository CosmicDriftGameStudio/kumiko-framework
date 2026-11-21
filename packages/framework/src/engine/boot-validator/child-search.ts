import { hasSearchableTextField } from "../entity-list-searchability.ts";
import { findEntity } from "../find-entity.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { CHILD_SEARCH_RULES } from "./child-search-rules.ts";

export function validateChildSearchRelations(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [entityName, relations] of Object.entries(feature.relations)) {
    for (const [relationName, relation] of Object.entries(relations)) {
      if (relation.type !== "hasMany" || relation.searchable !== true) continue;
      const where = `relation "${entityName}.${relationName}" (feature: "${feature.name}")`;
      const target = findEntity(featureMap, relation.target);
      if (target === undefined) {
        throw bootRuleError(CHILD_SEARCH_RULES.childSearchUnknownEntity, {
          message: `[Kumiko ChildSearch] ${where} is searchable but targets unknown entity "${relation.target}".`,
        });
      }
      if (target.fields[relation.foreignKey] === undefined) {
        throw bootRuleError(CHILD_SEARCH_RULES.childSearchUnknownForeignKey, {
          message: `[Kumiko ChildSearch] ${where} is searchable but "${relation.target}" has no field "${relation.foreignKey}".`,
        });
      }
      if (!hasSearchableTextField(target)) {
        throw bootRuleError(CHILD_SEARCH_RULES.childSearchNoSearchableField, {
          message: `[Kumiko ChildSearch] ${where} is searchable but "${relation.target}" has no searchable field, so there is nothing to match a term against.`,
        });
      }
    }
  }
}
