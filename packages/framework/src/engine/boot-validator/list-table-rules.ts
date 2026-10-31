import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_TABLE_RULES = {
  notObject: {
    id: "list-table/not-object",
    summary: "A list's table option is an object.",
    fix: "Write table as an object such as { rememberState: true } using only the allowed keys.",
  },
  unknownKeys: {
    id: "list-table/unknown-keys",
    summary: "A table option block uses only the keys its schema allows.",
    fix: "Remove the unknown keys or rename them to one of the allowed keys.",
  },
  optionNotBoolean: {
    id: "list-table/option-not-boolean",
    summary: "The boolean table switches (rememberState, columnPicker, pinning, ...) are booleans.",
    fix: "Set the table option to true or false.",
  },
  densityNotObject: {
    id: "list-table/density-not-object",
    summary: "table.density is an object.",
    fix: 'Write table.density as { default: "compact", userChoice: true }.',
  },
  densityEmpty: {
    id: "list-table/density-empty",
    summary: "table.density sets default and/or userChoice.",
    fix: "Set default and/or userChoice, or remove table.density.",
  },
  densityDefaultInvalid: {
    id: "list-table/density-default-invalid",
    summary: "table.density.default is one of the known densities.",
    fix: "Use one of the listed density values.",
  },
  densityUserChoiceNotBoolean: {
    id: "list-table/density-user-choice-not-boolean",
    summary: "table.density.userChoice is a boolean.",
    fix: "Set userChoice to true or false.",
  },
  hiddenNotBoolean: {
    id: "list-table/hidden-not-boolean",
    summary: "A column's hidden flag is a boolean.",
    fix: "Set hidden to true or remove it.",
  },
  hiddenWithoutColumnPicker: {
    id: "list-table/hidden-without-column-picker",
    summary: "Hidden columns need table.columnPicker, otherwise the user can never show them.",
    fix: "Set table: { columnPicker: true } or remove hidden from the column.",
  },
  hidesEveryColumn: {
    id: "list-table/hides-every-column",
    summary: "At least one list column starts visible.",
    fix: "Remove hidden from one column.",
  },
  exportNotAllowed: {
    id: "list-table/export-not-allowed",
    summary: "table.export is only declared on entityList and projectionList screens.",
    fix: "Remove table.export from this screen or section.",
  },
  exportNotObject: {
    id: "list-table/export-not-object",
    summary: "table.export is an object.",
    fix: "Write table.export as { xlsx: true, maxRows: 5000 }.",
  },
  exportXlsxNotTrue: {
    id: "list-table/export-xlsx-not-true",
    summary: "table.export.xlsx is true, the only export format.",
    fix: "Set xlsx: true.",
  },
  exportMaxRowsInvalid: {
    id: "list-table/export-max-rows-invalid",
    summary: "table.export.maxRows is an integer of at least 1.",
    fix: "Set a positive integer row limit or remove maxRows to use the default.",
  },
  exportMaxRowsTooLarge: {
    id: "list-table/export-max-rows-too-large",
    summary: "table.export.maxRows stays within the in-memory workbook limit.",
    fix: "Lower maxRows to the allowed maximum.",
  },
  columnPinnedInvalid: {
    id: "list-table/column-pinned-invalid",
    summary: "A column's pinned value is one of the known pin sides.",
    fix: "Use one of the listed pin values.",
  },
  columnPinnedWithoutPinning: {
    id: "list-table/column-pinned-without-pinning",
    summary: "A pinned column needs table.pinning, otherwise the pin has no effect.",
    fix: "Set table: { pinning: true } or remove pinned from the column.",
  },
  columnWidthInvalid: {
    id: "list-table/column-width-invalid",
    summary: "A column's width and minWidth are finite pixel counts greater than 0.",
    fix: "Set a positive finite number or remove the option.",
  },
  columnWidthWithoutResizing: {
    id: "list-table/column-width-without-resizing",
    summary: "A column's width or minWidth needs table.resizing, otherwise it has no effect.",
    fix: "Set table: { resizing: true } or remove width and minWidth from the column.",
  },
  columnMinWidthExceedsWidth: {
    id: "list-table/column-min-width-exceeds-width",
    summary: "A column's minWidth is not greater than its width.",
    fix: "Lower minWidth or raise width.",
  },
  bundledListsNotObject: {
    id: "bundled-lists/not-object",
    summary: "The bundledLists option is an object.",
    fix: "Write bundledLists as an object such as { table: { columnPicker: true } }.",
  },
  bundledListsUnknownKey: {
    id: "bundled-lists/unknown-key",
    summary: "bundledLists uses only the allowed keys.",
    fix: "Remove the unknown keys or rename them to one of the allowed keys.",
  },
  bundledListsTableNotObject: {
    id: "bundled-lists/table-not-object",
    summary: "bundledLists.table is an object.",
    fix: "Write bundledLists.table as an object such as { columnPicker: true }.",
  },
  bundledListsScreenOnlyKey: {
    id: "bundled-lists/screen-only-table-key",
    summary:
      "bundledLists.table leaves out grouping and totals, which depend on one list's fields.",
    fix: "Set grouping and totals in the table block of the individual screen.",
  },
  bundledListsPinFirstColumnNotBoolean: {
    id: "bundled-lists/pin-first-column-not-boolean",
    summary: "bundledLists.pinFirstColumn is a boolean.",
    fix: "Set pinFirstColumn to true or false.",
  },
  bundledListsPinFirstColumnWithoutPinning: {
    id: "bundled-lists/pin-first-column-without-pinning",
    summary: "bundledLists.pinFirstColumn needs bundledLists.table.pinning.",
    fix: "Set bundledLists.table.pinning: true or remove pinFirstColumn.",
  },
} as const satisfies BootRuleTable;
