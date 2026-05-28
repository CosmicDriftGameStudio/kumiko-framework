// @runtime client
// custom-fields bundle constants — feature-name + event-names.
//
// Spec: kumiko-platform/docs/plans/features/custom-fields.md
// Sprint plan: kumiko-platform/docs/plans/custom-fields-sprint.md

export const CUSTOM_FIELDS_FEATURE_NAME = "custom-fields";

// Qualified handler names (QN format: scope:type:name). Mirror text-
// content's Handler/Queries object pattern — Clients (z.B. die
// CustomFieldsFormSection web-component) referenzieren über das Object
// statt magic-strings.
export const CustomFieldsHandlers = {
  defineTenantField: "custom-fields:write:define-tenant-field",
  defineSystemField: "custom-fields:write:define-system-field",
  deleteTenantField: "custom-fields:write:delete-tenant-field",
  deleteSystemField: "custom-fields:write:delete-system-field",
  setCustomField: "custom-fields:write:set-custom-field",
  clearCustomField: "custom-fields:write:clear-custom-field",
} as const;

export const CustomFieldsQueries = {
  fieldDefinitionList: "custom-fields:query:field-definition:list",
} as const;

// Name unter dem die web-component im ExtensionSectionsProvider
// registriert wird — Apps referenzieren ihn im Screen-Schema via
// `component: { react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME } }`.
export const CUSTOM_FIELDS_FORM_EXTENSION_NAME = "CustomFieldsFormSection";

// Event-Type-Names (qualified at registration via r.defineEvent — final
// names are `custom-fields:event:field-definition-created` etc.).
// Short-names MUST be in kebab-case (no dots): qualifyEntityName runs toKebab
// which collapses dots to dashes, so a dotted short-name diverges from the
// registry key when handlers hand-build the qualified string.
export const FIELD_DEFINITION_CREATED_EVENT = "field-definition-created";
export const FIELD_DEFINITION_UPDATED_EVENT = "field-definition-updated";
export const FIELD_DEFINITION_DELETED_EVENT = "field-definition-deleted";

// Custom-field-VALUE events. Live auf host-aggregate stream (ES-Option-B).
// Short-names werden via r.defineEvent qualified zu `custom-fields:event:
// custom-field-set` etc. (qualifyEntityName runs toKebab which collapses dots
// to dashes — so the short-name MUST already be in dash form, otherwise
// handler-built strings won't match the registry key).
export const CUSTOM_FIELD_SET_EVENT = "custom-field-set";
export const CUSTOM_FIELD_CLEARED_EVENT = "custom-field-cleared";

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
