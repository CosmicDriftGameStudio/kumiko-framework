import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { normalizeListColumn } from "../screen-helpers.ts";
import {
  LIST_TABLE_DENSITIES,
  LIST_TABLE_DENSITY_KEYS,
  LIST_TABLE_OPTION_KEYS,
  type ListColumnSpec,
} from "../types/screen.ts";
import { validateColumnLayout } from "./list-column-layout.ts";
import { validateExportOptions } from "./list-table-export-options.ts";
import { rejectUnknownKeys } from "./list-table-reject-unknown-keys.ts";

const BOOLEAN_OPTION_KEYS = [
  "rememberState",
  "resetAll",
  "columnPicker",
  "pinning",
  "resizing",
  "keyboardNavigation",
] as const;

function validateDensity(where: string, density: unknown): void {
  if (!isPlainObject(density)) {
    throw new Error(
      `${where} table.density must be an object like { default: "compact", userChoice: true }.`,
    );
  }
  rejectUnknownKeys(where, "table.density", density, LIST_TABLE_DENSITY_KEYS);
  if (Object.keys(density).length === 0) {
    throw new Error(
      `${where} table.density is empty. Set default (${LIST_TABLE_DENSITIES.join(" | ")}) ` +
        `and/or userChoice, or remove table.density.`,
    );
  }
  if (density["default"] !== undefined && !isOneOf(LIST_TABLE_DENSITIES, density["default"])) {
    throw new Error(
      `${where} table.density.default is ${JSON.stringify(density["default"])} — ` +
        `must be one of ${LIST_TABLE_DENSITIES.map((d) => `"${d}"`).join(", ")}.`,
    );
  }
  if (density["userChoice"] !== undefined && typeof density["userChoice"] !== "boolean") {
    throw new Error(`${where} table.density.userChoice must be a boolean.`);
  }
}

function validateHiddenColumns(
  where: string,
  columnPickerOn: boolean,
  columns: readonly ListColumnSpec[],
): void {
  const normalized = columns.map(normalizeListColumn);
  for (const col of normalized) {
    if (col.hidden !== undefined && typeof col.hidden !== "boolean") {
      throw new Error(`${where} column "${col.field}" has a non-boolean "hidden".`);
    }
  }
  const hidden = normalized.filter((col) => col.hidden === true);
  // skip: no hidden columns, nothing to validate
  if (hidden.length === 0) return;
  if (!columnPickerOn) {
    throw new Error(
      `${where} column "${hidden[0]?.field}" is hidden but table.columnPicker is not enabled, ` +
        `so the user could never show it. Set table: { columnPicker: true } or remove "hidden".`,
    );
  }
  if (hidden.length === normalized.length) {
    throw new Error(
      `${where} hides every column. At least one column must start visible — remove "hidden" from one.`,
    );
  }
}

/** `where` is the full message prefix, e.g. `[Feature x] Screen "y" (entityList)`. */
export function validateListTableOptions(
  where: string,
  table: unknown,
  columns: readonly ListColumnSpec[],
  exportAllowed = false,
): void {
  if (table === undefined) {
    validateHiddenColumns(where, false, columns);
    validateColumnLayout(where, { pinning: false, resizing: false }, columns);
    // skip: no table block: nothing else to check
    return;
  }
  if (!isPlainObject(table)) {
    throw new Error(
      `${where} table must be an object like { rememberState: true }. ` +
        `Allowed keys: ${LIST_TABLE_OPTION_KEYS.join(", ")}.`,
    );
  }
  rejectUnknownKeys(where, "table", table, LIST_TABLE_OPTION_KEYS);
  for (const key of BOOLEAN_OPTION_KEYS) {
    if (table[key] !== undefined && typeof table[key] !== "boolean") {
      throw new Error(`${where} table.${key} must be a boolean, got ${typeof table[key]}.`);
    }
  }
  if (table["density"] !== undefined) validateDensity(where, table["density"]);
  if (table["export"] !== undefined) validateExportOptions(where, table["export"], exportAllowed);
  validateHiddenColumns(where, table["columnPicker"] === true, columns);
  validateColumnLayout(
    where,
    { pinning: table["pinning"] === true, resizing: table["resizing"] === true },
    columns,
  );
}
