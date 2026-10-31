import type { BootRuleTable } from "./boot-rule.ts";

export const ENTITY_SELECT_IMAGE_RULES = {
  multiSelectColumnsInvalid: {
    id: "multi-select/columns-invalid",
    summary: "Checkbox columns is 1, 2, 3 or 4.",
    fix: "Use a supported columns value.",
  },
  multiSelectMaxRowsInvalid: {
    id: "multi-select/max-rows-invalid",
    summary: "Checkbox maxRows is a positive integer.",
    fix: "Set maxRows to a positive integer.",
  },
  multiSelectColumnsWithoutCheckboxes: {
    id: "multi-select/columns-without-checkboxes",
    summary: 'columns is set only with display: "checkboxes".',
    fix: 'Set display: "checkboxes" or drop columns.',
  },
  multiSelectMaxRowsWithoutCheckboxes: {
    id: "multi-select/max-rows-without-checkboxes",
    summary: 'maxRows is set only with display: "checkboxes".',
    fix: 'Set display: "checkboxes" or drop maxRows.',
  },
  selectOptionToneInvalid: {
    id: "select/option-tone-invalid",
    summary: "Every select optionTones value is a known tone.",
    fix: "Use one of the listed tones.",
  },
  selectOptionsQueryUnsupported: {
    id: "select/options-query-unsupported",
    summary: "An entity select field has static options, no optionsQuery.",
    fix: "Use static options, or a reference field.",
  },
  selectAvailabilityQueryUnregistered: {
    id: "select/availability-query-unregistered",
    summary: "optionsAvailabilityQuery names a registered query handler.",
    fix: "Check the QN spelling and register the handler via r.queryHandler(...).",
  },
  conditionalOptionsWithOptionsQuery: {
    id: "select/conditional-options-with-options-query",
    summary: "A select field does not combine conditionalOptions with optionsQuery.",
    fix: "Remove either conditionalOptions or optionsQuery.",
  },
  conditionalOptionsRuleEmpty: {
    id: "select/conditional-options-rule-empty",
    summary: "Every conditionalOptions rule lists at least one option.",
    fix: "Drop the rule or add options.",
  },
  conditionalOptionUnknown: {
    id: "select/conditional-option-unknown",
    summary: "conditionalOptions list only options of the select field.",
    fix: "List an option that exists in options.",
  },
  conditionalOptionDuplicate: {
    id: "select/conditional-option-duplicate",
    summary: "An option belongs to one conditionalOptions rule only.",
    fix: "Remove the option from one of the rules.",
  },
  conditionalOptionDefault: {
    id: "select/conditional-option-default",
    summary: "The default option is not inside a conditionalOptions rule.",
    fix: "Move the default out of the rule.",
  },
  conditionalWhenOwnField: {
    id: "select/conditional-when-own-field",
    summary: "A conditionalOptions when depends on a different field.",
    fix: "Make the condition depend on another field.",
  },
  conditionalWhenUnknownField: {
    id: "select/conditional-when-unknown-field",
    summary: "A conditionalOptions when.field is a field of the entity.",
    fix: "Use an existing field of the entity.",
  },
  conditionalWhenValueNotOption: {
    id: "select/conditional-when-value-not-option",
    summary: "A conditionalOptions when compares only against options of the condition field.",
    fix: "Compare against an option of the condition field.",
  },
  multiSelectOptionsEmpty: {
    id: "multi-select/options-empty",
    summary: "A multiSelect field has at least one option.",
    fix: "Add an option.",
  },
  multiSelectDefaultNotOption: {
    id: "multi-select/default-not-option",
    summary: "Every multiSelect default value is one of its options.",
    fix: "Use options only in default.",
  },
  imageVariantName: {
    id: "image-variant/name-invalid",
    summary: "An image variant name matches the variant name pattern.",
    fix: "Rename the variant.",
  },
  imageVariantSizeAndMaxEdge: {
    id: "image-variant/size-and-max-edge",
    summary: "An image variant sets size or maxEdge, not both.",
    fix: "Pick one.",
  },
  imageVariantSizeInvalid: {
    id: "image-variant/size-invalid",
    summary: "An image variant size is a positive integer up to the edge limit.",
    fix: "Fix width and height.",
  },
  imageVariantMaxEdgeInvalid: {
    id: "image-variant/max-edge-invalid",
    summary: "An image variant maxEdge is a positive integer up to the edge limit.",
    fix: "Fix maxEdge.",
  },
  imageVariantQualityInvalid: {
    id: "image-variant/quality-invalid",
    summary: "An image variant quality is an integer in 1..100.",
    fix: "Fix quality.",
  },
  imageVariantBlurInvalid: {
    id: "image-variant/blur-invalid",
    summary: "An image variant blur is a finite number in (0, max].",
    fix: "Fix blur.",
  },
  imageVariantBlurRegionInvalid: {
    id: "image-variant/blur-region-invalid",
    summary: "Image variant blurRegions lie within the unit square.",
    fix: "Keep x/y/width/height within 0..1.",
  },
} as const satisfies BootRuleTable;
