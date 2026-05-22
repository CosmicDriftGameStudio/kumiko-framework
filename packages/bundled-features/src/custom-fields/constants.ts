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

// Custom-field-VALUE events. Live auf host-aggregate stream (ES-Option-B).
// Short-names werden via r.defineEvent qualified zu `custom-fields:event:
// custom-field.set` etc.
export const CUSTOM_FIELD_SET_EVENT = "custom-field.set";
export const CUSTOM_FIELD_CLEARED_EVENT = "custom-field.cleared";

// Extension-name für r.useExtension("customFields", "<entity>") — registriert
// dass eine host-entity Custom-Fields haben darf.
export const CUSTOM_FIELDS_EXTENSION = "customFields";

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
