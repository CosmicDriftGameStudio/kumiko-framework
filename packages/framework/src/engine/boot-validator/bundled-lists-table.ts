import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { LIST_TABLE_OPTION_KEYS } from "../types/screen.ts";
import { validateListTableOptions } from "./list-table-options.ts";

export const BUNDLED_LISTS_OPTION_KEYS = ["table", "pinFirstColumn"] as const;

// grouping and totals name fields of one list, so they cannot be shared across lists
const SCREEN_ONLY_TABLE_KEYS = ["grouping", "totals"] as const;

export function validateBundledListsOptions(options: unknown): void {
  if (!isPlainObject(options)) {
    throw new Error("bundledLists must be an object like { table: { columnPicker: true } }.");
  }
  const unknownKeys = Object.keys(options).filter(
    (key) => !BUNDLED_LISTS_OPTION_KEYS.some((allowed) => allowed === key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `bundledLists has unknown key(s) ${unknownKeys.map((k) => `"${k}"`).join(", ")}. ` +
        `Allowed keys: ${BUNDLED_LISTS_OPTION_KEYS.join(", ")}.`,
    );
  }
  const table = options["table"];
  if (!isPlainObject(table)) {
    const allowed = LIST_TABLE_OPTION_KEYS.filter(
      (key) => !SCREEN_ONLY_TABLE_KEYS.some((screenOnly) => screenOnly === key),
    );
    throw new Error(
      `bundledLists.table must be an object like { columnPicker: true }. ` +
        `Allowed keys: ${allowed.join(", ")}.`,
    );
  }
  for (const key of SCREEN_ONLY_TABLE_KEYS) {
    if (table[key] !== undefined) {
      throw new Error(
        `bundledLists.table.${key} is not allowed: ${key} depends on the fields of one list. ` +
          `Set it in the table block of that screen.`,
      );
    }
  }
  validateListTableOptions("bundledLists", table, [], true);
  const pinFirstColumn = options["pinFirstColumn"];
  if (pinFirstColumn !== undefined && typeof pinFirstColumn !== "boolean") {
    throw new Error("bundledLists.pinFirstColumn must be a boolean.");
  }
  if (pinFirstColumn === true && table["pinning"] !== true) {
    throw new Error("bundledLists.pinFirstColumn needs bundledLists.table.pinning: true.");
  }
}
