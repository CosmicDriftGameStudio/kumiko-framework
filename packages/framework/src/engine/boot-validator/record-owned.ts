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
