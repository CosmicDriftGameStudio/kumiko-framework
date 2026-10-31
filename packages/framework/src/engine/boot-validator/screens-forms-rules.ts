import type { BootRuleTable } from "./boot-rule.ts";

export const FORM_FIELD_RULES = {
  embeddedListUnknownSubField: {
    id: "form/embedded-list-unknown-sub-field",
    summary: "embeddedList cell options name sub-fields of the embedded schema.",
    fix: "Name an existing sub-field.",
  },
  embeddedListCardHiddenEditable: {
    id: "form/embedded-list-card-hidden-editable",
    summary: "embeddedList.cardHiddenCells lists only read-only cells.",
    fix: "Add the cell to readOnlyCells or remove it from cardHiddenCells.",
  },
  embeddedListOnNonListField: {
    id: "form/embedded-list-on-non-list-field",
    summary: "embeddedList is set only on an embedded list field.",
    fix: "Remove embeddedList or point it at an embedded list field.",
  },
  prefillTodayNeedsDate: {
    id: "form/prefill-today-needs-date",
    summary: 'The "today" prefill is set only on a date field.',
    fix: "Use a date field or a different prefill.",
  },
  prefillCurrentUserFieldType: {
    id: "form/prefill-current-user-field-type",
    summary: "A currentUser prefill matches the field type.",
    fix: "Use a text field (or text/reference for id) or a different prefill property.",
  },
  affixUnknownField: {
    id: "form/affix-unknown-field",
    summary: "A { field } prefix or suffix names another field of the same form.",
    fix: "Name a field of the same form.",
  },
  fillActionUnknownField: {
    id: "form/fill-action-unknown-field",
    summary: "fillAction.params read fields of the same form.",
    fix: "Name fields of the same form in pick or map.",
  },
  fillActionFieldType: {
    id: "form/fill-action-field-type",
    summary: "fillAction targets a text, number, decimal or bigInt field.",
    fix: "Remove fillAction or use a fitting field type.",
  },
  fillActionSensitiveField: {
    id: "form/fill-action-sensitive-field",
    summary: "fillAction does not target a sensitive, writeOnly or password field.",
    fix: "Remove fillAction.",
  },
  requiredFieldWithoutWidget: {
    id: "form/required-field-without-widget",
    summary: "A required entityEdit field has a widget to fill it.",
    fix: "Set required: false, move the field to a custom-component section, or drop the required constraint.",
  },
  handlerEmpty: {
    id: "form/handler-empty",
    summary: "An inline form's handler is a non-empty string.",
    fix: "Set handler to a non-empty handler name.",
  },
  fieldsEmpty: {
    id: "form/fields-empty",
    summary: "An inline form declares at least one field.",
    fix: "Declare at least one field.",
  },
  fieldTypeMissing: {
    id: "form/field-type-missing",
    summary: "Every inline form field declares a type.",
    fix: 'Declare a type such as "text", "number" or "select".',
  },
  optionsQueryPayloadSelfReference: {
    id: "form/options-query-payload-self-reference",
    summary: "optionsQueryPayload does not reference its own field.",
    fix: "Reference a different field of the form.",
  },
  optionsQueryPayloadUnknownField: {
    id: "form/options-query-payload-unknown-field",
    summary: "optionsQueryPayload references fields of the same form.",
    fix: "Reference another field of the same form.",
  },
  configSecretAlsoConfigKey: {
    id: "form/config-secret-also-config-key",
    summary: "A configEdit field is mapped in configKeys or secretKeys, not both.",
    fix: "Keep one of the mappings.",
  },
  configSecretScope: {
    id: "form/config-secret-scope",
    summary: "Secret-mapped configEdit fields are on a tenant-scope screen.",
    fix: 'Use scope "tenant" or drop the secret mapping.',
  },
  configSecretFieldType: {
    id: "form/config-secret-field-type",
    summary: "A secret-mapped configEdit field is a writeOnly text field.",
    fix: "Make the field a writeOnly text field.",
  },
  configSecretUndeclared: {
    id: "form/config-secret-undeclared",
    summary: "A secret-mapped configEdit field names a secret declared via r.secret().",
    fix: "Declare the secret with r.secret() or fix the secret name.",
  },
  writeOnlyField: {
    id: "form/write-only-field",
    summary: "Inline form fields do not declare writeOnly.",
    fix: 'Remove writeOnly; use format: "password" for a masked input.',
  },
  selectConditionalOptions: {
    id: "form/select-conditional-options",
    summary: "Inline form select fields do not declare conditionalOptions.",
    fix: "Remove conditionalOptions from the field.",
  },
  selectOptionsQueryEmpty: {
    id: "form/select-options-query-empty",
    summary: "A select field's optionsQuery is non-empty when set.",
    fix: "Set it to a query name or remove it.",
  },
  selectOptionsAndQuery: {
    id: "form/select-options-and-query",
    summary: "A select field declares static options or optionsQuery, not both.",
    fix: "Pick one of options and optionsQuery.",
  },
  selectQueryAndAvailability: {
    id: "form/select-query-and-availability",
    summary: "optionsAvailabilityQuery is not combined with optionsQuery.",
    fix: "Remove optionsAvailabilityQuery or use static options.",
  },
  optionsAvailabilityQueryEmpty: {
    id: "form/options-availability-query-empty",
    summary: "optionsAvailabilityQuery is non-empty when set.",
    fix: "Set it to a query name or remove it.",
  },
  optionsQueryPayloadWithoutQuery: {
    id: "form/options-query-payload-without-query",
    summary: "optionsQueryPayload is set only together with optionsQuery.",
    fix: "Set optionsQuery or remove optionsQueryPayload.",
  },
  moneyCurrencyMissing: {
    id: "form/money-currency-missing",
    summary: "An inline form money field declares its currency source.",
    fix: 'Declare currency: { kind: "literal", code } or { kind: "tenant" }.',
  },
  moneyCurrencyNotObject: {
    id: "form/money-currency-not-object",
    summary: "A money field's currency is an object.",
    fix: 'Declare currency: { kind: "literal", code } or { kind: "tenant" }.',
  },
  moneyCurrencyLiteralCode: {
    id: "form/money-currency-literal-code",
    summary: "A literal money currency has a non-empty string code.",
    fix: 'Pass the ISO code, for example { kind: "literal", code: "EUR" }.',
  },
  moneyCurrencyUnknownKind: {
    id: "form/money-currency-unknown-kind",
    summary: 'A money field\'s currency kind is "literal" or "tenant".',
    fix: 'Declare currency: { kind: "literal", code } or { kind: "tenant" }.',
  },
} as const satisfies BootRuleTable;
