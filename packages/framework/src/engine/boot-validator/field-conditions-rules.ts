import type { BootRuleTable } from "./boot-rule.ts";

export const FIELD_CONDITION_RULES = {
  requiredWithRequiredWhen: {
    id: "field-condition/required-with-required-when",
    summary: "A field does not set required: true together with requiredWhen.",
    fix: "Drop required; requiredWhen covers the conditional case.",
  },
  requiredWithVisibleWhen: {
    id: "field-condition/required-with-visible-when",
    summary: "A field does not set required: true together with visibleWhen.",
    fix: "Drop required and use requiredWhen with the same condition as visibleWhen.",
  },
  comparisonValueNotOption: {
    id: "field-condition/comparison-value-not-option",
    summary: "A condition on a select field compares only against options of that field.",
    fix: "Compare against one of the select field's options.",
  },
  conditionOnOwnField: {
    id: "field-condition/on-own-field",
    summary:
      "A visibleWhen, requiredWhen or when condition depends on a different field or sibling.",
    fix: "Point the condition's field at another field of the entity (or a sibling sub-field).",
  },
  unknownConditionField: {
    id: "field-condition/unknown-field",
    summary: "A condition's field names a field of the entity or a sub-field of the same row.",
    fix: "Use an existing field of the entity, or a sibling sub-field inside an embedded row.",
  },
  conditionFieldTypeNotComparable: {
    id: "field-condition/field-type-not-comparable",
    summary:
      "A visibleWhen, requiredWhen or lockedWhen field stores a plain scalar the condition can compare.",
    fix: "Use a text, select, boolean, number or reference field (more types for sub-fields).",
  },
  fileSubFieldSearchable: {
    id: "file-field/sub-field-searchable",
    summary: "A file or image sub-field is not searchable.",
    fix: "Remove searchable from the file sub-field.",
  },
  fileMaxCountInvalid: {
    id: "file-field/max-count-invalid",
    summary: "A file sub-field maxCount is a positive integer.",
    fix: "Set maxCount to a positive integer.",
  },
  fileMaxSizeInvalid: {
    id: "file-field/max-size-invalid",
    summary: "A file sub-field maxSize is a parseable size string.",
    fix: 'Use a size like "10mb" or "500kb".',
  },
  acceptEntryEmpty: {
    id: "file-field/accept-entry-empty",
    summary: "The accept list has no empty entries.",
    fix: 'List file extensions like "pdf".',
  },
  acceptEntryNotBareExtension: {
    id: "file-field/accept-entry-not-bare-extension",
    summary: "Every accept entry is a bare lower-case file extension.",
    fix: 'Use "pdf" instead of ".pdf", a MIME type or a wildcard.',
  },
  optionToneNotAnOption: {
    id: "embedded-field/option-tone-not-an-option",
    summary: "Every optionTones key of a select sub-field is one of its options.",
    fix: "Remove the tone or add the option.",
  },
  derivedSourceNotNumeric: {
    id: "embedded-field/derived-source-not-numeric",
    summary: "A derived cell reads only number, decimal or money sub-fields.",
    fix: "Point from at number, decimal or money sub-fields of the same row.",
  },
  inRangeNeedsThreeSources: {
    id: "embedded-field/in-range-needs-three-sources",
    summary: 'A derived cell with op "inRange" has exactly three sources (value, min, max).',
    fix: "List exactly value, min and max in from.",
  },
  inRangeTargetNotSelect: {
    id: "embedded-field/in-range-target-not-select",
    summary:
      'The target of an "inRange" derived cell is a select sub-field with the inside and outside options.',
    fix: "Make the target a select sub-field that lists both the inside and the outside option.",
  },
  derivedTargetNotNumeric: {
    id: "embedded-field/derived-target-not-numeric",
    summary: "The target of a derived cell is a number, decimal or money sub-field.",
    fix: "Change the target sub-field's type to number, decimal or money.",
  },
  derivedWhenReadsDerived: {
    id: "embedded-field/derived-when-reads-derived",
    summary: "A derived cell's when reads a stored sub-field, not another derived cell.",
    fix: "Read a stored sub-field in when.",
  },
  fileSubFieldInDerived: {
    id: "embedded-field/file-sub-field-in-derived",
    summary: "File sub-fields are not used in derived cells or totals.",
    fix: "Remove the file sub-field from derived, totals and totalsMatch.",
  },
} as const satisfies BootRuleTable;
