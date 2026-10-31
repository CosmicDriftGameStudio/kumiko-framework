import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_TABLE_AGGREGATE_RULES = {
  groupingNotObject: {
    id: "list-table/grouping-not-object",
    summary: "table.grouping is an object.",
    fix: 'Write table.grouping as { field: "status" }.',
  },
  groupingValueInvalid: {
    id: "list-table/grouping-value-invalid",
    summary: "Each table.grouping option has the value type its schema expects.",
    fix: "Change the option to the type named in the message.",
  },
  groupingNoField: {
    id: "list-table/grouping-no-field",
    summary: "table.grouping names a field, or offers fields with userChoice: true.",
    fix: "Set field, or userChoice: true with at least one entry in fields.",
  },
  groupingFieldsWithoutUserChoice: {
    id: "list-table/grouping-fields-without-user-choice",
    summary:
      "table.grouping.fields comes with userChoice: true, otherwise the user cannot pick them.",
    fix: "Set userChoice: true or remove fields.",
  },
  totalsNotArray: {
    id: "list-table/totals-not-array",
    summary: "table.totals is a non-empty array.",
    fix: 'Write table.totals as [{ field: "amount", kind: "sum" }] or remove it.',
  },
  totalEntryNotObject: {
    id: "list-table/total-entry-not-object",
    summary: "Every table.totals entry is an object.",
    fix: "Write each entry as { field, kind }.",
  },
  totalFieldNotString: {
    id: "list-table/total-field-not-string",
    summary: "A table.totals entry names its field as a string.",
    fix: "Set field to a field name.",
  },
  totalKindInvalid: {
    id: "list-table/total-kind-invalid",
    summary: "A table.totals entry uses a supported aggregate kind.",
    fix: "Use one of the listed kinds.",
  },
  aggregateFieldNotColumn: {
    id: "list-table/aggregate-field-not-column",
    summary: "Fields used by table.grouping and table.totals are columns of the screen.",
    fix: "Add the field to the screen's columns or use a listed column.",
  },
  aggregateFieldNotOnEntity: {
    id: "list-table/aggregate-field-not-on-entity",
    summary: "Fields used by table.grouping and table.totals exist on the entity behind the list.",
    fix: "Use a field of the entity.",
  },
  aggregateFieldSecret: {
    id: "list-table/aggregate-field-secret",
    summary: "table.grouping and table.totals skip encrypted, personal and secret fields.",
    fix: "Pick a field that is not encrypted, personal or secret.",
  },
  groupingFieldNotGroupable: {
    id: "list-table/grouping-field-not-groupable",
    summary: "table.grouping uses only field types that can be grouped by.",
    fix: "Group by a groupable field.",
  },
  totalKindUnsupported: {
    id: "list-table/total-kind-unsupported",
    summary: "A table.totals kind is supported on the type of its field.",
    fix: "Use sum or avg on number, decimal, money or bigInt fields; min and max also take date and timestamp.",
  },
  aggregateParamMissing: {
    id: "list-table/aggregate-param-missing",
    summary: "A list with table.grouping or table.totals binds a query that accepts aggregate.",
    fix: "Reuse entityListSchema or listAggregatePayloadSchema, answer it with answerListAggregate, or remove grouping and totals.",
  },
  rangeFacetFieldType: {
    id: "list-table/range-facet-field-type",
    summary: 'A facet with display "range" is on a number, decimal, money or bigInt field.',
    fix: "Use another facet display or a numeric field.",
  },
  rangeFacetNotFilterable: {
    id: "list-table/range-facet-not-filterable",
    summary:
      'A facet with display "range" is on a filterable field that is not encrypted, personal or secret.',
    fix: "Set filterable: true on the field or drop the range facet.",
  },
} as const satisfies BootRuleTable;
