import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { isKebabSegment } from "../qualified-name.ts";
import { LIST_BULK_ACTION_KEYS, type RowAction } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_BULK_ACTION_RULES } from "./list-bulk-actions-rules.ts";

function validateBulkActionTarget(
  where: string,
  bulkId: string,
  target: unknown,
  rowActions: readonly RowAction[],
): void {
  if (typeof target !== "string" || target === "") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.rowActionMissing, {
      message: `${where} bulk action "${bulkId}" needs rowAction: the id of a row action.`,
    });
  }
  const rowAction = rowActions.find((action) => action.id === target);
  if (rowAction === undefined) {
    const known = rowActions.map((action) => action.id).join(", ") || "(none)";
    throw bootRuleError(LIST_BULK_ACTION_RULES.rowActionUndeclared, {
      message:
        `${where} bulk action "${bulkId}" points at rowAction "${target}", which is not declared ` +
        `in rowActions. Declared row actions: ${known}.`,
    });
  }
  if (rowAction.kind !== undefined && rowAction.kind !== "writeHandler") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.rowActionNotWriteHandler, {
      message:
        `${where} bulk action "${bulkId}" points at rowAction "${target}" of kind "${rowAction.kind}". ` +
        `Bulk actions run one server write per row, so only writeHandler row actions are allowed.`,
    });
  }
}

/** `where` is the full message prefix, e.g. `[Feature x] Screen "y" (entityList)`. */
export function validateListBulkActions(
  where: string,
  bulkActions: unknown,
  rowActions: readonly RowAction[] | undefined,
): void {
  // skip: no bulk actions declared
  if (bulkActions === undefined) return;
  if (!Array.isArray(bulkActions) || bulkActions.length === 0) {
    throw bootRuleError(LIST_BULK_ACTION_RULES.notArray, {
      message: `${where} bulkActions must be a non-empty array like [{ id: "archive", rowAction: "archive" }].`,
    });
  }
  const seen = new Set<string>();
  for (const entry of bulkActions) {
    if (!isPlainObject(entry)) {
      throw bootRuleError(LIST_BULK_ACTION_RULES.entryNotObject, {
        message: `${where} bulkActions entries must be objects with id and rowAction.`,
      });
    }
    const id = entry["id"];
    if (typeof id !== "string" || !isKebabSegment(id)) {
      throw bootRuleError(LIST_BULK_ACTION_RULES.idNotKebab, {
        message: `${where} bulk action id ${JSON.stringify(id)} must be a kebab-case string.`,
      });
    }
    if (seen.has(id))
      throw bootRuleError(LIST_BULK_ACTION_RULES.idDuplicate, {
        message: `${where} declares bulk action "${id}" twice.`,
      });
    seen.add(id);
    const unknown = Object.keys(entry).filter((key) => !isOneOfBulkKeys(key));
    if (unknown.length > 0) {
      throw bootRuleError(LIST_BULK_ACTION_RULES.unknownKey, {
        message:
          `${where} bulk action "${id}" has unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
          `Allowed keys: ${LIST_BULK_ACTION_KEYS.join(", ")}.`,
      });
    }
    validateBulkActionTarget(where, id, entry["rowAction"], rowActions ?? []);
  }
}

function isOneOfBulkKeys(key: string): boolean {
  return LIST_BULK_ACTION_KEYS.some((allowed) => allowed === key);
}
