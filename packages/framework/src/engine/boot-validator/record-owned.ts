import type { FeatureDefinition } from "../types";
import type { ResolvedPiiFlags } from "../types/fields";

// A recordOwned field is encrypted under `record:<entity>:<id>` (kms-adapter-types.ts)
// and forgetSubject's subjectIdSchema requires that id to be a UUID
// (crypto-shredding/handlers/forget-subject.write.ts) — an entity with
// idType: "serial" would encrypt the field but could never satisfy a
// forget-subject request for it.
export function validateRecordOwnedSubjects(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    if (entity.idType !== "serial") continue;

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const annot = field as ResolvedPiiFlags; // @cast-boundary schema-walk
      if (annot.recordOwned !== true) continue;

      throw new Error(
        `[Feature ${feature.name}] entity "${entityName}" field "${fieldName}" is recordOwned but the entity declares idType: "serial" — the record subject key is "record:${entityName}:<id>" and forgetSubject validates that id as a UUID, so this field would be encrypted but could never be shredded. Set idType: "uuid" on entity "${entityName}", or give field "${fieldName}" a different personal stance (personal: "self" / "tenant" / { of: "<field>" }).`,
      );
    }
  }
}
