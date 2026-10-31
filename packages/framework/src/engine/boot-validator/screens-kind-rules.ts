import type { BootRuleTable } from "./boot-rule.ts";

export const SCREEN_KIND_RULES = {
  unknownFieldReference: {
    id: "screen/unknown-field-reference",
    summary: "A column or layout field names a field that exists on the screen's entity.",
    fix: "Name a field of the entity.",
  },
  entityNotDeclared: {
    id: "screen/entity-not-declared",
    summary: "A screen's entity is declared in its feature.",
    fix: "Declare the entity in this feature or fix the name.",
  },
  queryEmpty: {
    id: "screen/query-empty",
    summary: "A screen or section query is a non-empty string.",
    fix: "Set query to a registered query name.",
  },
  columnsEmpty: {
    id: "screen/columns-empty",
    summary: "A list screen declares at least one column.",
    fix: "Declare at least one column.",
  },
  filterInNeedsArray: {
    id: "screen/filter-in-needs-array",
    summary: "A filter with op in has an array value.",
    fix: "Pass an array as filter.value.",
  },
  headerActionRowClick: {
    id: "screen/header-action-row-click",
    summary: "Record header actions do not set rowClick, because a record screen has no row.",
    fix: "Remove rowClick.",
  },
  defaultSortUnknownField: {
    id: "entity-list/default-sort-unknown-field",
    summary: "defaultSort.field is a field of the entity.",
    fix: "Name an existing entity field.",
  },
  filterUnknownField: {
    id: "entity-list/filter-unknown-field",
    summary: "A screen filter names a field of the entity.",
    fix: "Name an existing entity field.",
  },
  filterFieldNotAllowed: {
    id: "entity-list/filter-field-not-allowed",
    summary:
      "A screen filter does not target an encrypted, personal or secret field the list handler rejects.",
    fix: "Drop the filter or filter on another field; personal fields only allow op eq with find exact or fuzzy.",
  },
  filterFieldNotFilterable: {
    id: "entity-list/filter-field-not-filterable",
    summary: "A screen filter targets a filterable field.",
    fix: "Set filterable: true on the field or pick another field.",
  },
  filterOpNotAllowed: {
    id: "entity-list/filter-op-not-allowed",
    summary: "A screen filter uses an op allowed for the field type.",
    fix: "Use one of the allowed ops for the field.",
  },
  crossFeatureEditNeedsEntityId: {
    id: "entity-list/cross-feature-edit-needs-entity-id",
    summary: "A rowAction navigating to a cross-feature entityEdit screen sets entityId.",
    fix: "Set entityId to the row field naming the target entity's id.",
  },
  pageSizeInvalid: {
    id: "entity-list/page-size-invalid",
    summary: "pageSize is a positive integer.",
    fix: "Set pageSize to a positive integer.",
  },
  createScreenUnresolved: {
    id: "entity-list/create-screen-unresolved",
    summary: "createScreen resolves to a registered screen in the same feature.",
    fix: "Point createScreen at a screen of this feature.",
  },
  configEditFieldsEmpty: {
    id: "config-edit/fields-empty",
    summary: "A configEdit screen declares at least one field.",
    fix: "Declare at least one field.",
  },
  configEditFieldTypeMissing: {
    id: "config-edit/field-type-missing",
    summary: "Every configEdit field declares a type.",
    fix: "Set type on the field.",
  },
  configEditLayoutUnknownField: {
    id: "config-edit/layout-unknown-field",
    summary: "A configEdit layout names a declared field.",
    fix: "Name a declared field.",
  },
  configEditFieldWithoutConfigKey: {
    id: "config-edit/field-without-config-key",
    summary: "Every configEdit field maps to a config key in configKeys.",
    fix: "Add the field to configKeys with a <feature>:config:<short> key.",
  },
  configEditConfigKeyUnknown: {
    id: "config-edit/config-key-unknown",
    summary: "A configKeys entry names a config key declared in a feature.",
    fix: "Use an existing <feature>:config:<short> key.",
  },
  configEditWriteOnlyNotEncrypted: {
    id: "config-edit/write-only-not-encrypted",
    summary: "A writeOnly configEdit field maps to an encrypted config key.",
    fix: 'Declare the key with encrypted: true or backing: "secrets".',
  },
  configEditSecretKeyUnknownField: {
    id: "config-edit/secret-key-unknown-field",
    summary: "secretKeys names declared fields.",
    fix: "Name a declared field.",
  },
  secretMintRevealFieldsEmpty: {
    id: "secret-mint/reveal-fields-empty",
    summary: "A secretMint screen reveals at least one field.",
    fix: "Declare at least one reveal field.",
  },
  secretMintRevealFieldNameEmpty: {
    id: "secret-mint/reveal-field-name-empty",
    summary: "Every reveal.fields entry has a non-empty string field.",
    fix: "Set field to a non-empty string.",
  },
  secretMintRevealFieldDuplicate: {
    id: "secret-mint/reveal-field-duplicate",
    summary: "Each reveal field appears once.",
    fix: "Remove the duplicate entry.",
  },
  secretMintRevealFieldLabelEmpty: {
    id: "secret-mint/reveal-field-label-empty",
    summary: "Every reveal.fields entry has a non-empty string label.",
    fix: "Set label to a non-empty string.",
  },
  entityEditRecordTitleFieldUnknown: {
    id: "entity-edit/record-title-field-unknown",
    summary: "recordTitleField is a field of the screen's entity.",
    fix: "Name an existing entity field.",
  },
  entityEditReadOnlyFieldUnknown: {
    id: "entity-edit/read-only-field-unknown",
    summary: "The readOnly condition field is a field of the screen's entity.",
    fix: "Name an existing entity field.",
  },
} as const satisfies BootRuleTable;
