import type { BootRuleTable } from "./boot-rule.ts";

export const ENTITY_REFERENCE_EMBEDDED_RULES = {
  referenceUnknownFeature: {
    id: "reference/unknown-feature",
    summary: "A reference field targets a registered feature.",
    fix: "Fix the feature prefix of the reference target.",
  },
  referenceUnknownEntity: {
    id: "reference/unknown-entity",
    summary: "A reference field targets an entity of the target feature.",
    fix: "Fix the entity name of the reference target.",
  },
  referenceUnknownLabelField: {
    id: "reference/unknown-label-field",
    summary: "A reference labelField is a field of the referenced entity.",
    fix: "Name an existing field of the referenced entity.",
  },
  referenceTargetWithoutListHandler: {
    id: "reference/target-without-list-handler",
    summary: "The referenced entity has a registered list query handler.",
    fix: "Register r.queryHandler(defineEntityListHandler(...)) in the target feature.",
  },
  referenceOptionsQueryEmpty: {
    id: "reference/options-query-empty",
    summary: "A reference optionsQuery is not empty.",
    fix: "Drop the property or name a query handler.",
  },
  referenceOptionsQueryUnregistered: {
    id: "reference/options-query-unregistered",
    summary: "A reference optionsQuery names a registered query handler.",
    fix: "Check the QN spelling and register the handler via r.queryHandler(...).",
  },
  embeddedSchemaEmpty: {
    id: "embedded-field/schema-empty",
    summary: "An embedded field declares at least one sub-field.",
    fix: "Declare a sub-field in the embedded schema.",
  },
  embeddedSubFieldTypeInvalid: {
    id: "embedded-field/sub-field-type-invalid",
    summary: "An embedded sub-field uses an allowed sub-field type.",
    fix: "Use one of the allowed embedded sub-field types.",
  },
  embeddedDecimalScaleInvalid: {
    id: "embedded-field/decimal-scale-invalid",
    summary: "A decimal sub-field scale is an integer between 0 and 15.",
    fix: "Set scale to an integer between 0 and 15.",
  },
  embeddedSelectOptionsEmpty: {
    id: "embedded-field/select-options-empty",
    summary: "A select sub-field has at least one option.",
    fix: "Add an option.",
  },
  embeddedMinItemsNegative: {
    id: "embedded-field/min-items-negative",
    summary: "An embedded list minItems is at least 0.",
    fix: "Set minItems to 0 or more.",
  },
  embeddedMaxItemsTooSmall: {
    id: "embedded-field/max-items-too-small",
    summary: "An embedded list maxItems is at least 1.",
    fix: "Set maxItems to 1 or more.",
  },
  embeddedMinItemsAboveMax: {
    id: "embedded-field/min-items-above-max",
    summary: "An embedded list minItems is not greater than maxItems.",
    fix: "Set minItems at or below maxItems.",
  },
  embeddedRequiredMinItemsZero: {
    id: "embedded-field/required-min-items-zero",
    summary: "A required embedded list does not set minItems: 0.",
    fix: "Drop minItems or set required: false.",
  },
  embeddedDerivedCellNotInSchema: {
    id: "embedded-field/derived-cell-not-in-schema",
    summary: "Every derived cell is a sub-field in the embedded schema.",
    fix: "Add the sub-field to the schema or remove the derived cell.",
  },
  embeddedPercentNeedsTwoSources: {
    id: "embedded-field/percent-needs-two-sources",
    summary: 'A derived cell with op "percent" has exactly two sources (base, rate).',
    fix: "List base and rate in from.",
  },
  embeddedDerivedSourceUnknown: {
    id: "embedded-field/derived-source-unknown",
    summary: "A derived cell reads only sub-fields that exist in the schema.",
    fix: "Read an existing sub-field.",
  },
  embeddedDerivedSourceIsDerived: {
    id: "embedded-field/derived-source-is-derived",
    summary: "A derived cell reads stored sub-fields, not other derived cells.",
    fix: "Read only stored sub-fields.",
  },
  embeddedTotalsFromEmpty: {
    id: "embedded-field/totals-from-empty",
    summary: "A totals entry lists at least one source in from.",
    fix: "List a number, money or decimal sub-field.",
  },
  embeddedTotalsNotNumeric: {
    id: "embedded-field/totals-not-numeric",
    summary: "Totals list only number, money or decimal sub-fields.",
    fix: "List only number, money or decimal sub-fields.",
  },
  embeddedTotalsMatchKeyNotMoney: {
    id: "embedded-field/totals-match-key-not-money",
    summary: "A totalsMatch key is a money sub-field of the schema.",
    fix: "Use a money sub-field as the totalsMatch key.",
  },
  embeddedTotalsMatchSiblingNotMoney: {
    id: "embedded-field/totals-match-sibling-not-money",
    summary: "A totalsMatch value maps to a money field of the entity.",
    fix: "Map it to a money field of the entity.",
  },
  embeddedListOptionsOnNonList: {
    id: "embedded-field/list-options-on-non-list",
    summary: "minItems, maxItems, derived, totals and totalsMatch are set only on embedded lists.",
    fix: "Set multiple: true or remove the options.",
  },
} as const satisfies BootRuleTable;
