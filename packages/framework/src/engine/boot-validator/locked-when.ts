import type { EntityDefinition, FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import { conditionLeaves } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { assertConditionShape } from "./condition-shape.ts";
import { ENTITY_STRUCTURE_RULES } from "./entity-structure-rules.ts";
import { FIELD_CONDITION_RULES } from "./field-conditions-rules.ts";

function isCiphertextAtRest(field: FieldDefinition): boolean {
  return (
    ("pii" in field && field.pii === true) ||
    ("userOwned" in field && field.userOwned !== undefined) ||
    ("tenantOwned" in field && field.tenantOwned === true) ||
    ("recordOwned" in field && field.recordOwned === true) ||
    ("encrypted" in field && field.encrypted === true)
  );
}

// Types whose stored value is a plain scalar that the condition's `===` can match.
// Compound, temporal, array and bigint columns come back in another shape than the
// literal an author writes, so such a lock would silently never hold.
export const LOCKABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "longText",
  "boolean",
  "select",
  "number",
  "reference",
]);

export function validateLockedWhen(feature: FeatureDefinition): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const { lockedWhen } = entity;
    if (typeof lockedWhen !== "object") continue;
    assertConditionShape(
      `Entity "${entityName}" in feature "${feature.name}": lockedWhen`,
      lockedWhen,
    );
    for (const leaf of conditionLeaves(lockedWhen))
      assertLockedWhenLeaf(entityName, entity, feature, leaf.field);
  }
}

function assertLockedWhenLeaf(
  entityName: string,
  entity: EntityDefinition,
  feature: FeatureDefinition,
  leafField: string,
): void {
  const where = `Entity "${entityName}" in feature "${feature.name}": lockedWhen field "${leafField}"`;
  const field = entity.fields[leafField];
  if (!field) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.lockedWhenUnknownField, {
      message: `${where} is not a field of the entity (known: ${Object.keys(entity.fields).sort().join(", ")}).`,
    });
  }
  if (isCiphertextAtRest(field)) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.lockedWhenCiphertextField, {
      message: `${where} is personal or encrypted — the lock condition is evaluated on the stored value, which is ciphertext. Use a plaintext field.`,
    });
  }
  if (field.access?.read !== undefined) {
    throw bootRuleError(ENTITY_STRUCTURE_RULES.lockedWhenReadRestricted, {
      message: `${where} has a read restriction — roles that cannot read it get records without it, and the client would show every record as locked. Drop field access.read or use another field.`,
    });
  }
  if (!LOCKABLE_FIELD_TYPES.has(field.type)) {
    throw bootRuleError(FIELD_CONDITION_RULES.conditionFieldTypeNotComparable, {
      message: `${where} has type "${field.type}", which does not store a plain scalar the condition can compare. Use a text, select, boolean, number or reference field.`,
    });
  }
}

// --- Transition validation ---
