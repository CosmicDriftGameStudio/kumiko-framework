import { FIELD_APPROVAL_FIELD_TYPES, FIELD_CHANGE_REQUEST_ENTITY_NAME } from "../field-approval.ts";
import { findEntity } from "../find-entity.ts";
import { normalizeAccessEntry } from "../ownership.ts";
import type { FeatureDefinition } from "../types/index.ts";
import type { BootRule } from "./boot-rule.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";
import { checkRoleListAccess } from "./ownership.ts";

export function validateFieldApproval(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  knownRoles: ReadonlySet<string> | undefined,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const fail = (rule: BootRule, message: string): never => {
        throw bootRuleError(rule, {
          message: `[Feature ${feature.name}] entity "${entityName}" field "${fieldName}": ${message}`,
        });
      };

      if (field.type === "embedded") {
        for (const [subName, sub] of Object.entries(field.schema)) {
          if (sub.access?.approve !== undefined) {
            fail(
              ENTITY_DECLARATION_RULES.fieldApproveEmbedded,
              `sub-field "${subName}" sets access.approve; only top-level fields can.`,
            );
          }
        }
      }

      const approve = field.access?.approve;
      if (approve === undefined) continue;
      if (approve.length === 0) {
        fail(ENTITY_DECLARATION_RULES.fieldApproveRolesEmpty, "access.approve is empty.");
      }
      checkRoleListAccess(
        approve,
        knownRoles,
        `entity "${entityName}" field "${fieldName}" access.approve`,
        feature.name,
      );
      if (!FIELD_APPROVAL_FIELD_TYPES.has(field.type)) {
        fail(
          ENTITY_DECLARATION_RULES.fieldApproveFieldType,
          `access.approve is not supported on type "${field.type}".`,
        );
      }
      const writeMap = normalizeAccessEntry(field.access?.write);
      if (writeMap !== undefined) {
        const outside = approve.filter((role) => !Object.hasOwn(writeMap, role));
        if (outside.length > 0) {
          fail(
            ENTITY_DECLARATION_RULES.fieldApproveOutsideWrite,
            `approve roles ${outside.join(", ")} are not in access.write.`,
          );
        }
      }
      const requestEntity = findEntity(featureMap, FIELD_CHANGE_REQUEST_ENTITY_NAME);
      if (requestEntity?.parentRef?.allowedTypes.includes(entityName) !== true) {
        fail(
          ENTITY_DECLARATION_RULES.fieldApproveNeedsFeature,
          `the field-approval feature must be mounted with "${entityName}" in its parents.`,
        );
      }
    }
  }
}
