import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { isKebabSegment } from "../qualified-name.ts";
import {
  LIST_BULK_ACTION_KEYS,
  LIST_BULK_FORM_ACTION_KEYS,
  type RowAction,
} from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_BULK_ACTION_RULES } from "./list-bulk-actions-rules.ts";
import {
  findNavTargetEntry,
  isSensitiveOrPasswordField,
  type NavigateTargetLookups,
  renderedEditFieldNames,
} from "./screens-actions.ts";

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

function validateBulkFormTarget(
  where: string,
  bulkId: string,
  entry: Readonly<Record<string, unknown>>,
  featureName: string,
  lookups: NavigateTargetLookups,
): void {
  const label = entry["label"];
  if (typeof label !== "string" || label === "") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formLabelMissing, {
      message: `${where} bulk action "${bulkId}" needs label: the i18n key of its button.`,
    });
  }
  const screenId = entry["screen"];
  if (typeof screenId !== "string" || screenId === "") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formScreenMissing, {
      message: `${where} bulk action "${bulkId}" needs screen: the id of an actionForm screen.`,
    });
  }
  const target = findNavTargetEntry({ name: featureName }, screenId, lookups);
  if (target === undefined) {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formScreenUnresolved, {
      message:
        `${where} bulk action "${bulkId}" opens screen "${screenId}", which does not resolve to a ` +
        `registered screen. Use the id of a screen in this feature or <feature>:screen:<id>.`,
    });
  }
  const form = target.screen;
  if (form.type !== "actionForm") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formScreenNotActionForm, {
      message:
        `${where} bulk action "${bulkId}" opens screen "${screenId}", a "${form.type}" screen. ` +
        `Point screen at an actionForm screen; it receives the selected ids in idsField.`,
    });
  }
  const idsField = entry["idsField"];
  if (typeof idsField !== "string" || idsField === "") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formIdsFieldMissing, {
      message:
        `${where} bulk action "${bulkId}" needs idsField: the field of form "${screenId}" that ` +
        `receives the selected ids.`,
    });
  }
  const field = Object.hasOwn(form.fields, idsField) ? form.fields[idsField] : undefined;
  if (field === undefined) {
    const known = Object.keys(form.fields).sort().join(", ") || "(none)";
    throw bootRuleError(LIST_BULK_ACTION_RULES.formIdsFieldUnknown, {
      message:
        `${where} bulk action "${bulkId}" has idsField "${idsField}", which form "${screenId}" does ` +
        `not declare. Form fields: ${known}.`,
    });
  }
  if (field.type !== "multiSelect" || field.display !== "count") {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formIdsFieldNotList, {
      message:
        `${where} bulk action "${bulkId}" has idsField "${idsField}", which is not a list field. ` +
        `Declare it on form "${screenId}" as { type: "multiSelect", options: [], display: "count" }; ` +
        `the handler then receives the ids as a string array.`,
    });
  }
  if (
    isSensitiveOrPasswordField(field) ||
    !renderedEditFieldNames(form.layout.sections).has(idsField)
  ) {
    throw bootRuleError(LIST_BULK_ACTION_RULES.formIdsFieldNotRendered, {
      message:
        `${where} bulk action "${bulkId}" has idsField "${idsField}", which form "${screenId}" ` +
        `marks sensitive or leaves out of its layout; the renderer would drop the ids. Add the ` +
        `field to the layout (visible: false still carries the value) and remove sensitive.`,
    });
  }
}

/** `where` is the full message prefix, e.g. `[Feature x] Screen "y" (entityList)`. */
export function validateListBulkActions(
  where: string,
  bulkActions: unknown,
  rowActions: readonly RowAction[] | undefined,
  featureName: string,
  lookups: NavigateTargetLookups,
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
        message: `${where} bulkActions entries must be objects with id and rowAction, or id, label, screen and idsField.`,
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
    const opensForm = Object.hasOwn(entry, "screen");
    const allowedKeys: readonly string[] = opensForm
      ? LIST_BULK_FORM_ACTION_KEYS
      : LIST_BULK_ACTION_KEYS;
    const unknown = Object.keys(entry).filter((key) => !allowedKeys.includes(key));
    if (unknown.length > 0) {
      throw bootRuleError(LIST_BULK_ACTION_RULES.unknownKey, {
        message:
          `${where} bulk action "${id}" has unknown key(s) ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
          `Allowed keys: ${allowedKeys.join(", ")}.`,
      });
    }
    if (opensForm) validateBulkFormTarget(where, id, entry, featureName, lookups);
    else validateBulkActionTarget(where, id, entry["rowAction"], rowActions ?? []);
  }
}
