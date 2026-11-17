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
