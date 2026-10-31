import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { LIST_TABLE_EXPORT_KEYS, MAX_EXPORT_MAX_ROWS } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { rejectUnknownKeys } from "./list-table-reject-unknown-keys.ts";
import { LIST_TABLE_RULES } from "./list-table-rules.ts";

export function validateExportOptions(where: string, value: unknown, allowed: boolean): void {
  if (!allowed) {
    throw bootRuleError(LIST_TABLE_RULES.exportNotAllowed, {
      message: `${where} table.export is only available on entityList and projectionList screens. Remove it here.`,
    });
  }
  if (!isPlainObject(value)) {
    throw bootRuleError(LIST_TABLE_RULES.exportNotObject, {
      message: `${where} table.export must be an object like { xlsx: true, maxRows: 5000 }.`,
    });
  }
  rejectUnknownKeys(where, "table.export", value, LIST_TABLE_EXPORT_KEYS);
  if (value["xlsx"] !== true) {
    throw bootRuleError(LIST_TABLE_RULES.exportXlsxNotTrue, {
      message: `${where} table.export.xlsx must be true (the only export format).`,
    });
  }
  if (value["maxRows"] !== undefined) validateMaxRows(where, value["maxRows"]);
}

function validateMaxRows(where: string, maxRows: unknown): void {
  if (typeof maxRows !== "number" || !Number.isInteger(maxRows) || maxRows < 1) {
    throw bootRuleError(LIST_TABLE_RULES.exportMaxRowsInvalid, {
      message:
        `${where} table.export.maxRows is ${JSON.stringify(maxRows)} — must be an integer >= 1. ` +
        `Set a positive row limit or remove maxRows to use the default.`,
    });
  }
  if (maxRows > MAX_EXPORT_MAX_ROWS) {
    throw bootRuleError(LIST_TABLE_RULES.exportMaxRowsTooLarge, {
      message:
        `${where} table.export.maxRows is ${maxRows} — must be at most ${MAX_EXPORT_MAX_ROWS} ` +
        `(the workbook is built in memory). Lower maxRows.`,
    });
  }
}
