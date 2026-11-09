import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_BULK_ACTION_RULES = {
  notArray: {
    id: "list-bulk/not-array",
    summary: "bulkActions is a non-empty array.",
    fix: 'Write bulkActions as [{ id: "archive", rowAction: "archive" }] or remove it.',
  },
  entryNotObject: {
    id: "list-bulk/entry-not-object",
    summary: "Every bulkActions entry is an object with id and rowAction.",
    fix: "Write each entry as { id, rowAction }.",
  },
  idNotKebab: {
    id: "list-bulk/id-not-kebab",
    summary: "A bulk action id is a kebab-case string.",
    fix: "Rename the id to kebab-case.",
  },
  idDuplicate: {
    id: "list-bulk/id-duplicate",
    summary: "Bulk action ids are unique within a list.",
    fix: "Rename or remove the duplicate bulk action.",
  },
  unknownKey: {
    id: "list-bulk/unknown-key",
    summary: "A bulk action uses only the allowed keys.",
    fix: "Remove the unknown keys.",
  },
  rowActionMissing: {
    id: "list-bulk/row-action-missing",
    summary: "A bulk action names the id of a row action in rowAction.",
    fix: "Set rowAction to the id of a declared row action.",
  },
  rowActionUndeclared: {
    id: "list-bulk/row-action-undeclared",
    summary: "A bulk action's rowAction is declared in the list's rowActions.",
    fix: "Declare the row action in rowActions or point rowAction at a declared one.",
  },
  rowActionNotWriteHandler: {
    id: "list-bulk/row-action-not-write-handler",
    summary:
      "Bulk actions run one server write per row, so they point at writeHandler row actions.",
    fix: "Point rowAction at a writeHandler row action.",
  },
  formLabelMissing: {
    id: "list-bulk/form-label-missing",
    summary: "A bulk form action has a label (i18n key) for its button.",
    fix: "Set label to an i18n key.",
  },
  formScreenMissing: {
    id: "list-bulk/form-screen-missing",
    summary: "A bulk form action names the screen it opens in screen.",
    fix: "Set screen to the id of an actionForm screen.",
  },
  formScreenUnresolved: {
    id: "list-bulk/form-screen-unresolved",
    summary: "A bulk form action's screen resolves to a registered screen.",
    fix: "Use the id of a screen in this feature or a fully-qualified <feature>:screen:<id>.",
  },
  formScreenNotActionForm: {
    id: "list-bulk/form-screen-not-action-form",
    summary: "A bulk form action opens an actionForm screen.",
    fix: "Point screen at an actionForm screen.",
  },
  formIdsFieldMissing: {
    id: "list-bulk/form-ids-field-missing",
    summary: "A bulk form action names the form field that receives the selected ids.",
    fix: "Set idsField to a field of the target form.",
  },
  formIdsFieldUnknown: {
    id: "list-bulk/form-ids-field-unknown",
    summary: "A bulk form action's idsField is a field of the target form.",
    fix: "Declare the field on the target form or point idsField at a declared one.",
  },
  formIdsFieldNotList: {
    id: "list-bulk/form-ids-field-not-list",
    summary: 'A bulk form action\'s idsField is a multiSelect field with display: "count".',
    fix: 'Declare the field as { type: "multiSelect", options: [], display: "count" } on the target form.',
  },
  formIdsFieldNotRendered: {
    id: "list-bulk/form-ids-field-not-rendered",
    summary:
      "A bulk form action's idsField is shown by the target form's layout and not sensitive.",
    fix: "Add the field to the form layout (visible: false hides it but keeps the value) and drop sensitive.",
  },
} as const satisfies BootRuleTable;
