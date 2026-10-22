// custom-fields bundle constants — feature-name + event-names.
//
// Spec: kumiko-platform/docs/plans/features/custom-fields.md
// Sprint plan: kumiko-platform/docs/plans/custom-fields-sprint.md

export const CUSTOM_FIELDS_FEATURE_NAME = "custom-fields";

// Qualified handler names (QN format: scope:type:name). Mirrors text-
// content's Handler/Queries object pattern: clients (e.g. the
// CustomFieldsFormSection web component) reference the object instead of
// magic strings.
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

// Name the web component registers under in ExtensionSectionsProvider.
export const CUSTOM_FIELDS_FORM_EXTENSION_NAME = "CustomFieldsFormSection";

// Entity-CRUD auto-events for the `field-definition` entity. registry.ts emits
// these as `${entityName}.created`/`.updated` (dot form) — they do NOT run
// through r.defineEvent/toKebab, so the dot MUST stay.
export const FIELD_DEFINITION_AGGREGATE_TYPE = "field-definition";
export const FIELD_DEFINITION_CREATED_EVENT = "field-definition.created";
export const FIELD_DEFINITION_UPDATED_EVENT = "field-definition.updated";
// Qualified at registration via r.defineEvent — final name is
// `custom-fields:event:field-definition-deleted`. Short-name MUST be kebab
// (no dots): qualifyEntityName runs toKebab which collapses dots to dashes.
export const FIELD_DEFINITION_DELETED_EVENT = "field-definition-deleted";

// Custom-field VALUE events. They live on the host aggregate stream (ES option B).
// Short names are qualified via r.defineEvent to `custom-fields:event:
// custom-field-set` etc. (qualifyEntityName runs toKebab which collapses dots
// to dashes, so the short name MUST already be in dash form, otherwise
// handler-built strings won't match the registry key).
export const CUSTOM_FIELD_SET_EVENT = "custom-field-set";
export const CUSTOM_FIELD_CLEARED_EVENT = "custom-field-cleared";

// Extension name for r.useExtension("customFields", "<entity>"): registers
// that a host entity may have custom fields.
export const CUSTOM_FIELDS_EXTENSION = "customFields";

// Default RBAC of the value-write and list paths. Apps with their own role
// vocabulary (publicstatus: "Admin"/"Editor" instead of "TenantAdmin"/
// "TenantMember") override via createCustomFieldsFeature({
// valueWriteRoles, fieldDefinitionListRoles }); otherwise the hard-wired
// bundle QNs that CustomFieldsFormSection dispatches are access_denied for
// every app user.
export const DEFAULT_VALUE_WRITE_ROLES = ["TenantAdmin", "TenantMember"] as const;
export const DEFAULT_FIELD_DEFINITION_LIST_ROLES = ["TenantAdmin"] as const;
// Default-RBAC of the definition-CRUD triad (define-/update-/delete-tenant-field).
// Apps with their own role vocabulary override via
// createCustomFieldsFeature({ fieldDefinitionWriteRoles }) — otherwise those three
// hard-wired handler QNs are access_denied for every app-user without a
// "TenantAdmin" role (same Role-Naming-Drift as DEFAULT_VALUE_WRITE_ROLES above).
export const DEFAULT_FIELD_DEFINITION_WRITE_ROLES = ["TenantAdmin"] as const;

// Field-type union, identical to the core field type system (spec lines 59-73:
// `identical to entity field types`). Builder-reuse promise: whatever
// `r.field.X()` can do, a custom field definition can do too.
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
