import { isSelfPiiField } from "../../crypto/is-self-pii-field.ts";
import { isRecordKeyedField } from "../../crypto/subject-resolver.ts";
import type { ResolvedPiiFlags } from "../types/fields.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";

// A recordOwned field (or one with whenAbsent: "self") is encrypted under `record:<entity>:<id>` (kms-adapter-types.ts)
// and forgetSubject's subjectIdSchema (crypto/kms-adapter.ts) requires that id
// to be a UUID — an entity with idType: "serial" would encrypt the field but
// could never satisfy a forget-subject request for it.
export function validateRecordOwnedSubjects(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (entity.idType !== "serial") continue;

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const annot = field as ResolvedPiiFlags; // @cast-boundary schema-walk
      if (annot.recordOwned !== true && annot.userOwned?.whenAbsent !== "self") continue;

      throw bootRuleError(ENTITY_DECLARATION_RULES.recordOwnedSerialId, {
        message: `[Feature ${feature.name}] entity "${entityName}" field "${fieldName}" is recordOwned (or whenAbsent: "self") but the entity declares idType: "serial" — the record subject key is "record:${entityName}:<id>" and forgetSubject validates that id as a UUID, so this field would be encrypted but could never be shredded. Set idType: "uuid" on entity "${entityName}", or give field "${fieldName}" a different personal stance (personal: "self" / "tenant" / { of: "<field>" }).`,
      });
    }
  }
}

// Forgetting the owner erases the row's record key (recordSubjectsOwnedByUser), so that key may hold only that owner's data.
export function validateRecordKeyHeldByOneOwner(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const selfOwnerFields = new Set<string>();
    const recordOwnedFields: string[] = [];
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if ("recordOwned" in field && field.recordOwned === true) recordOwnedFields.push(fieldName);
      if ("userOwned" in field && field.userOwned?.whenAbsent === "self") {
        selfOwnerFields.add(field.userOwned.ownerField);
      }
    }
    if (selfOwnerFields.size === 0) continue;
    const owners = [...selfOwnerFields].map((name) => `"${name}"`).join(", ");
    if (recordOwnedFields.length > 0) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.recordKeyOneOwner, {
        message: `[Feature ${feature.name}] entity "${entityName}" has whenAbsent: "self" fields of owner field ${owners} and recordOwned field(s) ${recordOwnedFields.map((n) => `"${n}"`).join(", ")} — both sit under the record key "record:${entityName}:<id>", so forgetting the owner would erase the record's own data. Give the owner-keyed fields whenAbsent: "tenant", or keep the recordOwned data on a separate entity.`,
      });
    }
    if (selfOwnerFields.size > 1) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.recordKeyOneOwner, {
        message: `[Feature ${feature.name}] entity "${entityName}" uses whenAbsent: "self" with several owner fields (${owners}) — they share the record key "record:${entityName}:<id>", so forgetting one owner would erase the others' data. Use one owner field for all whenAbsent: "self" fields, or give the others whenAbsent: "tenant".`,
      });
    }
  }
}

export function validateForgetWithSubject(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (entity.forgetWithSubject !== true) continue;

    const hasSubjectField = Object.values(entity.fields).some(
      (field) => isSelfPiiField(field) || isRecordKeyedField(field),
    );
    if (!hasSubjectField) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.forgetWithSubjectWithoutSubjectField, {
        message: `[Feature ${feature.name}] entity "${entityName}" declares forgetWithSubject but has no personal: "self" or record-keyed field — no forget can name its row as a subject. Give the entity a personal: "self" or personal: { of: "id" } field, or remove forgetWithSubject.`,
      });
    }

    if (entity.retention?.strategy === "blockDelete") {
      throw bootRuleError(ENTITY_DECLARATION_RULES.forgetWithSubjectBlockDelete, {
        message: `[Feature ${feature.name}] entity "${entityName}" declares forgetWithSubject and retention.strategy "blockDelete" — a forget would have to delete a row the retention policy forbids deleting. Remove forgetWithSubject, or choose a retention strategy that allows deleting the row.`,
      });
    }
  }
}
