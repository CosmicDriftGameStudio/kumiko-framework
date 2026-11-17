import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { OwnershipRule, ParentRule } from "@cosmicdrift/kumiko-types/ownership";
import { findEntity } from "../find-entity.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { OWNERSHIP_RULES } from "./ownership-rules.ts";

type AccessSide = "read" | "write";
const ACCESS_SIDES: readonly AccessSide[] = ["read", "write"];

function isParentRule(rule: OwnershipRule | undefined): rule is ParentRule {
  return rule !== undefined && rule !== "all" && rule.kind === "parent";
}

// Buildable chains must stay finite: parentRuleToFragment and parentWritableByRole recurse through
// buildOwnershipClause with no guard of their own.
function assertNoCycle(
  featureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  startEntity: string,
  role: string,
  side: AccessSide,
): void {
  const visited = new Set<string>([startEntity]);
  let rule = findEntity(featureMap, startEntity)?.access?.[side]?.[role];
  while (isParentRule(rule)) {
    if (visited.has(rule.entity)) {
      throw bootRuleError(OWNERSHIP_RULES.parentCycle, {
        message:
          `[Kumiko Ownership] entity "${startEntity}".access.${side} (role: "${role}", feature: ` +
          `"${featureName}") follows fromParent rules back to "${rule.entity}": ` +
          `${[...visited, rule.entity].join(" -> ")}.`,
      });
    }
    visited.add(rule.entity);
    rule = findEntity(featureMap, rule.entity)?.access?.[side]?.[role];
  }
}

function assertParentRule(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
  entity: EntityDefinition,
  rule: ParentRule,
  where: string,
): void {
  const call = `fromParent("${rule.field}", "${rule.entity}")`;
  const field = entity.fields[rule.field];
  if (field?.type !== "reference" || field.multiple === true || field.entity !== rule.entity) {
    throw bootRuleError(OWNERSHIP_RULES.parentFieldNotReference, {
      message:
        `[Kumiko Ownership] ${where} uses ${call} (feature: "${feature.name}") but ` +
        `"${entityName}.${rule.field}" is not a single reference field pointing at "${rule.entity}".`,
    });
  }
  const parent = findEntity(featureMap, rule.entity);
  if (parent === undefined) {
    throw bootRuleError(OWNERSHIP_RULES.parentUnknownEntity, {
      message:
        `[Kumiko Ownership] ${where} uses ${call} (feature: "${feature.name}") but no entity ` +
        `"${rule.entity}" is registered.`,
    });
  }
  if (entity.tenancy === "global" || parent.tenancy === "global") {
    throw bootRuleError(OWNERSHIP_RULES.parentGlobalEntity, {
      message:
        `[Kumiko Ownership] ${where} uses ${call} (feature: "${feature.name}") but "${entityName}" ` +
        `or "${rule.entity}" has tenancy "global"; both must be tenant-bound.`,
    });
  }
}

export function validateParentOwnershipRules(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const side of ACCESS_SIDES) {
      const map = entity.access?.[side];
      if (map === undefined) continue;
      for (const [role, rule] of Object.entries(map)) {
        if (!isParentRule(rule)) continue;
        assertParentRule(
          feature,
          featureMap,
          entityName,
          entity,
          rule,
          `entity "${entityName}".access.${side}`,
        );
        assertNoCycle(feature.name, featureMap, entityName, role, side);
      }
    }
  }
}
