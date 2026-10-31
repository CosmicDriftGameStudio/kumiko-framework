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
} as const satisfies BootRuleTable;
