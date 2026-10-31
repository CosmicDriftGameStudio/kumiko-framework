import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { normalizeListColumn } from "../screen-helpers.ts";
import { LIST_COLUMN_PINS, type ListColumnSpec } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_TABLE_RULES } from "./list-table-rules.ts";

type ColumnLayoutFlags = { readonly pinning: boolean; readonly resizing: boolean };

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validatePixelWidth(where: string, field: string, key: string, value: unknown): void {
  if (!isPositiveFiniteNumber(value)) {
    throw bootRuleError(LIST_TABLE_RULES.columnWidthInvalid, {
      message:
        `${where} column "${field}" has ${key} ${JSON.stringify(value)} — ` +
        `must be a finite number of pixels greater than 0.`,
    });
  }
}

/** Checks `pinned`, `width` and `minWidth` of every column against the table's opt-in flags. */
export function validateColumnLayout(
  where: string,
  flags: ColumnLayoutFlags,
  columns: readonly ListColumnSpec[],
): void {
  for (const col of columns.map(normalizeListColumn)) {
    if (col.pinned !== undefined) {
      if (!isOneOf(LIST_COLUMN_PINS, col.pinned)) {
        throw bootRuleError(LIST_TABLE_RULES.columnPinnedInvalid, {
          message:
            `${where} column "${col.field}" has pinned ${JSON.stringify(col.pinned)} — ` +
            `must be one of ${LIST_COLUMN_PINS.map((pin) => `"${pin}"`).join(", ")}.`,
        });
      }
      if (!flags.pinning) {
        throw bootRuleError(LIST_TABLE_RULES.columnPinnedWithoutPinning, {
          message:
            `${where} column "${col.field}" is pinned but table.pinning is not enabled, ` +
            `so the pin would have no effect. Set table: { pinning: true } or remove "pinned".`,
        });
      }
    }
    for (const key of ["width", "minWidth"] as const) {
      const value = col[key];
      if (value === undefined) continue;
      validatePixelWidth(where, col.field, key, value);
      if (!flags.resizing) {
        throw bootRuleError(LIST_TABLE_RULES.columnWidthWithoutResizing, {
          message:
            `${where} column "${col.field}" sets ${key} but table.resizing is not enabled, ` +
            `so it would have no effect. Set table: { resizing: true } or remove "${key}".`,
        });
      }
    }
    if (col.width !== undefined && col.minWidth !== undefined && col.minWidth > col.width) {
      throw bootRuleError(LIST_TABLE_RULES.columnMinWidthExceedsWidth, {
        message:
          `${where} column "${col.field}" has minWidth ${col.minWidth} greater than width ${col.width}. ` +
          `Lower minWidth or raise width.`,
      });
    }
  }
}
