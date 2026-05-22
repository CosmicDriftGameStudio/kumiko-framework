// custom-fields bundle constants — feature-name + event-names.
//
// Spec: kumiko-platform/docs/plans/features/custom-fields.md
// Sprint plan: kumiko-platform/docs/plans/custom-fields-sprint.md

export const CUSTOM_FIELDS_FEATURE_NAME = "custom-fields";

// Event-Type-Names (qualified at registration via r.defineEvent — final
// names are `custom-fields:event:field-definition.created` etc.).
export const FIELD_DEFINITION_CREATED_EVENT = "field-definition.created";
export const FIELD_DEFINITION_UPDATED_EVENT = "field-definition.updated";
export const FIELD_DEFINITION_DELETED_EVENT = "field-definition.deleted";

// Field-type union — identisch zu Stammfeld-Field-Type-System (Spec Z.59-73:
// `Identisch zu Entity-Feld-Typen`). Builder-Reuse-Promise: was `r.field.X()`
// kann, kann eine Custom-Field-Definition auch.
export const SUPPORTED_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "enum",
  "money",
  "embedded",
] as const;
export type SupportedFieldType = (typeof SUPPORTED_FIELD_TYPES)[number];
