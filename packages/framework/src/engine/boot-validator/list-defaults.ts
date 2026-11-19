import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { LIST_TABLE_OPTION_KEYS } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { validateListTableOptions } from "./list-table-options.ts";
import { LIST_TABLE_RULES } from "./list-table-rules.ts";

export const LIST_DEFAULTS_OPTION_KEYS = ["table", "pinFirstColumn"] as const;

// grouping and totals name fields; summaryRow names a query of one list, so they cannot be shared across lists
const SCREEN_ONLY_TABLE_KEYS = ["grouping", "totals", "summaryRow"] as const;

export function validateListDefaultsOptions(options: unknown): void {
  if (!isPlainObject(options)) {
    throw bootRuleError(LIST_TABLE_RULES.listDefaultsNotObject, {
      message: "listDefaults must be an object like { table: { columnPicker: true } }.",
    });
  }
  const unknownKeys = Object.keys(options).filter(
    (key) => !LIST_DEFAULTS_OPTION_KEYS.some((allowed) => allowed === key),
  );
  if (unknownKeys.length > 0) {
    throw bootRuleError(LIST_TABLE_RULES.listDefaultsUnknownKey, {
      message:
        `listDefaults has unknown key(s) ${unknownKeys.map((k) => `"${k}"`).join(", ")}. ` +
        `Allowed keys: ${LIST_DEFAULTS_OPTION_KEYS.join(", ")}.`,
    });
  }
  const table = options["table"];
  if (!isPlainObject(table)) {
    const allowed = LIST_TABLE_OPTION_KEYS.filter(
      (key) => !SCREEN_ONLY_TABLE_KEYS.some((screenOnly) => screenOnly === key),
    );
    throw bootRuleError(LIST_TABLE_RULES.listDefaultsTableNotObject, {
      message:
        `listDefaults.table must be an object like { columnPicker: true }. ` +
        `Allowed keys: ${allowed.join(", ")}.`,
    });
  }
  for (const key of SCREEN_ONLY_TABLE_KEYS) {
    if (table[key] !== undefined) {
      throw bootRuleError(LIST_TABLE_RULES.listDefaultsScreenOnlyKey, {
        message:
          `listDefaults.table.${key} is not allowed: ${key} depends on the fields of one list. ` +
          `Set it in the table block of that screen.`,
      });
    }
  }
  validateListTableOptions("listDefaults", table, [], true);
  const pinFirstColumn = options["pinFirstColumn"];
  if (pinFirstColumn !== undefined && typeof pinFirstColumn !== "boolean") {
    throw bootRuleError(LIST_TABLE_RULES.listDefaultsPinFirstColumnNotBoolean, {
      message: "listDefaults.pinFirstColumn must be a boolean.",
    });
  }
  if (pinFirstColumn === true && table["pinning"] !== true) {
    throw bootRuleError(LIST_TABLE_RULES.listDefaultsPinFirstColumnWithoutPinning, {
      message: "listDefaults.pinFirstColumn needs listDefaults.table.pinning: true.",
    });
  }
}
