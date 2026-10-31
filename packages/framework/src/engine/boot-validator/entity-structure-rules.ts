import type { BootRuleTable } from "./boot-rule.ts";

export const ENTITY_STRUCTURE_RULES = {
  locatedByMissingField: {
    id: "entity/located-by-missing-field",
    summary: "A timestamp locatedBy names a field of the same entity.",
    fix: "Declare the tz field or use createLocatedTimestampField().",
  },
  locatedByNotTz: {
    id: "entity/located-by-not-tz",
    summary: "A timestamp locatedBy points at a tz field.",
    fix: "Point locatedBy at a field of type tz.",
  },
  indexColumnsEmpty: {
    id: "entity-index/columns-empty",
    summary: "An entity index lists at least one column.",
    fix: "Add a column to the index.",
  },
  indexUnknownColumn: {
    id: "entity-index/unknown-column",
    summary: "Every index column is a field of the entity or a base column.",
    fix: "Fix the column name.",
  },
  indexMultiValueColumn: {
    id: "entity-index/multi-value-column",
    summary: "An index does not cover a multi-value field.",
    fix: "Use a single-value field or remove it from the index.",
  },
  indexLongTextColumn: {
    id: "entity-index/long-text-column",
    summary: "An index does not cover a longText field.",
    fix: "Use text if the column needs an index, or use the SearchAdapter.",
  },
  indexTenantIdOnly: {
    id: "entity-index/tenant-id-only",
    summary: "A non-unique index is not on tenantId alone.",
    fix: "Remove the entry; buildEntityTable creates it automatically.",
  },
  indexUniqueEncryptedColumn: {
    id: "entity-index/unique-encrypted-column",
    summary: "A unique index does not cover an encrypted column.",
    fix: "Remove unique or encrypted.",
  },
  encryptedSearchable: {
    id: "entity/encrypted-searchable",
    summary: "An encrypted text field is not searchable.",
    fix: "Drop searchable: true or remove the encryption.",
  },
  encryptedSortable: {
    id: "entity/encrypted-sortable",
    summary: "An encrypted text field is not sortable.",
    fix: "Drop sortable: true or remove the encryption.",
  },
  encryptedFilterable: {
    id: "entity/encrypted-filterable",
    summary: "An encrypted text field is not filterable.",
    fix: "Drop filterable: true or remove the encryption.",
  },
  lockedWhenUnknownField: {
    id: "locked-when/unknown-field",
    summary: "The lockedWhen field is a field of the entity.",
    fix: "Name an existing field.",
  },
  lockedWhenCiphertextField: {
    id: "locked-when/ciphertext-field",
    summary: "The lockedWhen field is plaintext at rest.",
    fix: "Use a plaintext field.",
  },
  lockedWhenReadRestricted: {
    id: "locked-when/read-restricted-field",
    summary: "The lockedWhen field has no read restriction.",
    fix: "Drop field access.read or use another field.",
  },
  transitionUnknownField: {
    id: "transition/unknown-field",
    summary: "Transitions are declared for a field of the entity.",
    fix: "Fix the field name.",
  },
  transitionFieldNotSelect: {
    id: "transition/field-not-select",
    summary: "Transitions are declared for a select field.",
    fix: "Declare transitions on a select field.",
  },
  transitionStateNotOption: {
    id: "transition/state-not-option",
    summary: "Every transition source state is an option of the select field.",
    fix: "Use an existing option.",
  },
  transitionTargetNotOption: {
    id: "transition/target-not-option",
    summary: "Every transition target is an option of the select field.",
    fix: "Use an existing option.",
  },
  extendSchemaCollision: {
    id: "entity/extend-schema-collision",
    summary: "An extendSchema column does not collide with an entity field.",
    fix: "Rename the extension column or the entity field.",
  },
  derivedFieldCollision: {
    id: "entity/derived-field-collision",
    summary: "A derivedFields key does not match a stored field.",
    fix: "Rename the derivedFields key or the stored field.",
  },
  searchableRestrictedRead: {
    id: "entity/searchable-restricted-read",
    summary: "A searchable field has no restricted access.read.",
    fix: 'Drop searchable/find: "fuzzy" or access.read.',
  },
} as const satisfies BootRuleTable;
