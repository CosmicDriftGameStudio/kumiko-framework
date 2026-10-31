import type { BootRuleTable } from "./boot-rule.ts";

export const DERIVED_SQL_FIELD_RULES = {
  unknownField: {
    id: "derived-field/unknown-field",
    summary: "Every field a SQL derived field reads is a field of the entity.",
    fix: "Name an existing field of the entity (or of the related entity).",
  },
  unsupportedFieldType: {
    id: "derived-field/unsupported-field-type",
    summary: "A SQL derived field reads only scalar field types.",
    fix: "Read a text, number, decimal, boolean, date or timestamp field; money only as the measure of a related first.",
  },
  encryptedField: {
    id: "derived-field/encrypted-field",
    summary: "A SQL derived field does not read encrypted or secret fields.",
    fix: "Read a field that is neither encrypted nor secret.",
  },
  valueTypeMismatch: {
    id: "derived-field/value-type-mismatch",
    summary: "The derived field's valueType matches the type of the value it computes.",
    fix: "Set valueType to the expected value type.",
  },
  labelNeedsReference: {
    id: "derived-field/label-needs-reference",
    summary: "A measure with label: true reads a reference field (with a labelField).",
    fix: "Measure a reference field that declares a labelField, or drop label: true.",
  },
  activeOnNotDate: {
    id: "derived-field/active-on-not-date",
    summary: "The activeOn from/to fields are date fields.",
    fix: "Use date fields for activeOn.from and activeOn.to.",
  },
  inOperatorList: {
    id: "derived-field/in-operator-list",
    summary: 'A where condition with op "in" takes a list, and only "in" does.',
    fix: 'Use a list value exactly with op "in".',
  },
  nullOperator: {
    id: "derived-field/null-operator",
    summary: "A where condition with a null value uses op eq or ne.",
    fix: "Use op eq or ne for null, or give a value.",
  },
  relativeDateFieldType: {
    id: "derived-field/relative-date-field-type",
    summary: "A where condition with today needs a date field and with now a timestamp field.",
    fix: "Compare today with a date field and now with a timestamp field.",
  },
  sortableNeedsJoinIndex: {
    id: "derived-field/sortable-needs-join-index",
    summary: "A sortable related derived field has an index on the related table's join column.",
    fix: 'Declare indexes: [{ columns: ["<field>"] }] on the related entity.',
  },
  unknownRelatedEntity: {
    id: "derived-field/unknown-related-entity",
    summary: "The related entity of a derived field is registered.",
    fix: "Register the entity or fix the entity name.",
  },
  coalesceEmpty: {
    id: "derived-field/coalesce-empty",
    summary: "A coalesce derived field lists at least one field.",
    fix: "Add fields to coalesce.",
  },
  coalesceMixedTypes: {
    id: "derived-field/coalesce-mixed-types",
    summary: "All coalesce fields have the same type.",
    fix: "Coalesce fields of one type.",
  },
  moneyNeedsSql: {
    id: "derived-field/money-needs-sql",
    summary: 'A derived field with valueType "money" is a sql derived field.',
    fix: "Use a sql related first measure on a money field.",
  },
  sortableNeedsSql: {
    id: "derived-field/sortable-needs-sql",
    summary: "Only sql derived fields are sortable.",
    fix: "Make the field a sql derived field or drop sortable.",
  },
} as const satisfies BootRuleTable;
