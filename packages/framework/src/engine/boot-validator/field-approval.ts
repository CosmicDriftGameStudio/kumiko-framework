import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { collectPiiEncryptedFields } from "../../crypto/subject-resolver.ts";
import { FIELD_APPROVAL_FIELD_TYPES, FIELD_CHANGE_REQUEST_ENTITY_NAME } from "../field-approval.ts";
import { findEntity } from "../find-entity.ts";
import { normalizeAccessEntry } from "../ownership.ts";
import type { FeatureDefinition } from "../types/index.ts";
import type { BootRule } from "./boot-rule.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";
import { checkRoleListAccess } from "./ownership.ts";

type FieldApprovalFail = (rule: BootRule, message: string) => never;

function rejectApproveOnEmbeddedSubFields(field: FieldDefinition, fail: FieldApprovalFail): void {
  if (field.type !== "embedded") return;
  for (const [subName, sub] of Object.entries(field.schema)) {
    if (sub.access?.approve !== undefined) {
      fail(
        ENTITY_DECLARATION_RULES.fieldApproveEmbedded,
        `sub-field "${subName}" sets access.approve; only top-level fields can.`,
      );
    }
  }
}

function validateApproveFieldShape(
  entity: EntityDefinition,
  entityName: string,
  fieldName: string,
  field: FieldDefinition,
  approve: readonly string[],
  featureName: string,
  knownRoles: ReadonlySet<string> | undefined,
  fail: FieldApprovalFail,
): void {
  if (approve.length === 0) {
    fail(ENTITY_DECLARATION_RULES.fieldApproveRolesEmpty, "access.approve is empty.");
  }
  checkRoleListAccess(
    approve,
    knownRoles,
    `entity "${entityName}" field "${fieldName}" access.approve`,
    featureName,
  );
  if (!FIELD_APPROVAL_FIELD_TYPES.has(field.type)) {
    fail(
      ENTITY_DECLARATION_RULES.fieldApproveFieldType,
      `access.approve is not supported on type "${field.type}".`,
    );
  }
  const holdsSecret =
    ("encrypted" in field && field.encrypted === true) ||
    ("writeOnly" in field && field.writeOnly === true);
  if (holdsSecret && !collectPiiEncryptedFields(entity).includes(fieldName)) {
    fail(
      ENTITY_DECLARATION_RULES.fieldApproveUnsealedSecret,
      "access.approve on an encrypted or writeOnly field stores the pending value unsealed.",
    );
  }
}

function validateApproveRolesWithinWrite(
  field: FieldDefinition,
  approve: readonly string[],
  fail: FieldApprovalFail,
): void {
  const writeMap = normalizeAccessEntry(field.access?.write);
  if (writeMap === undefined) {
    fail(ENTITY_DECLARATION_RULES.fieldApproveNeedsWrite, "access.approve needs access.write.");
    return;
  }
  const outside = approve.filter((role) => !Object.hasOwn(writeMap, role));
  if (outside.length > 0) {
    fail(
      ENTITY_DECLARATION_RULES.fieldApproveOutsideWrite,
      `approve roles ${outside.join(", ")} are not in access.write.`,
    );
  }
}

export function validateFieldApproval(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  knownRoles: ReadonlySet<string> | undefined,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const fail: FieldApprovalFail = (rule, message) => {
        throw bootRuleError(rule, {
          message: `[Feature ${feature.name}] entity "${entityName}" field "${fieldName}": ${message}`,
        });
      };

      rejectApproveOnEmbeddedSubFields(field, fail);

      const approve = field.access?.approve;
      if (approve === undefined) continue;
      validateApproveFieldShape(
        entity,
        entityName,
        fieldName,
        field,
        approve,
        feature.name,
        knownRoles,
        fail,
      );
      validateApproveRolesWithinWrite(field, approve, fail);
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
