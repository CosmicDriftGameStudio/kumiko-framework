import type { EntityDefinition } from "../engine/types/fields";

type AnyField = EntityDefinition["fields"][string];

/** True when the field's own row id is the PII subject (`pii: true`). */
export function isSelfPiiField(field: AnyField): boolean {
  return "pii" in field && field.pii === true;
}
