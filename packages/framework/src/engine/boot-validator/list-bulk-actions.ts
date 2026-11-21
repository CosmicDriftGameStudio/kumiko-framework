import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { zodDef, zodShapeField } from "../../env/_zod-introspect.ts";
import { unwrapObjectSchema } from "../handler-field-references.ts";
import { isKebabSegment, isValidQn, parseQn } from "../qualified-name.ts";
import type { FeatureDefinition } from "../types/index.ts";
import {
  LIST_BULK_ACTION_KEYS,
  LIST_BULK_FORM_ACTION_KEYS,
  MAX_BULK_SELECTION,
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

type ActionFormTarget = Extract<
  NonNullable<ReturnType<typeof findNavTargetEntry>>["screen"],
  { readonly type: "actionForm" }
>;

function resolveBulkFormScreen(
  where: string,
  bulkId: string,
  entry: Readonly<Record<string, unknown>>,
  featureName: string,
  lookups: NavigateTargetLookups,
): { readonly screenId: string; readonly form: ActionFormTarget } {
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
  return { screenId, form };
}

function validateBulkIdsField(
  where: string,
  bulkId: string,
  entry: Readonly<Record<string, unknown>>,
  screenId: string,
  form: ActionFormTarget,
): void {
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

const MAX_WRAPPER_DEPTH = 8;

function findArraySchema(field: z.ZodType): z.ZodArray | undefined {
  let current: z.ZodType | undefined = field;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH && current !== undefined; depth++) {
    if (current instanceof z.ZodArray) return current;
    current = zodDef(current)?.innerType;
  }
  return undefined;
}

// Zod's bag.maximum stays empty for arrays, so the max_length checks are read directly.
function arrayMaximum(array: z.ZodArray): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (const check of array._zod.def.checks ?? []) {
    const def = check._zod.def;
    if (def.check === "max_length" && "maximum" in def && typeof def.maximum === "number") {
      smallest = Math.min(smallest, def.maximum);
    }
  }
  return smallest;
}

// The client cap MAX_BULK_SELECTION does not bind a direct /api/write, so the handler schema must.
function validateBulkIdsBounded(
  where: string,
  bulkId: string,
  idsField: string,
  form: ActionFormTarget,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // skip: an unresolvable handler is reported by the write-handler registration rule
  if (!isValidQn(form.handler)) return;
  const { scope, name } = parseQn(form.handler);
  const schema = featureMap.get(scope)?.writeHandlers[name]?.schema;
  const objectSchema = schema === undefined ? undefined : unwrapObjectSchema(schema);
  // skip: only an object schema has per-field bounds to read
  if (objectSchema === undefined) return;
  const field = zodShapeField(objectSchema, idsField);
  const array = field === undefined ? undefined : findArraySchema(field);
  if (array !== undefined && arrayMaximum(array) <= MAX_BULK_SELECTION) return;
  throw bootRuleError(LIST_BULK_ACTION_RULES.formIdsFieldUnbounded, {
    message:
      `${where} bulk action "${bulkId}" sends the selected ids in "${idsField}" to handler ` +
      `"${form.handler}", whose schema does not bound that field to at most ${MAX_BULK_SELECTION} ids; ` +
      `a direct /api/write would accept an unbounded list. Declare ` +
      `${idsField}: z.array(...).max(MAX_BULK_SELECTION) in the handler schema.`,
  });
}

function validateBulkFormTarget(
  where: string,
  bulkId: string,
  entry: Readonly<Record<string, unknown>>,
  featureName: string,
  lookups: NavigateTargetLookups,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const { screenId, form } = resolveBulkFormScreen(where, bulkId, entry, featureName, lookups);
  validateBulkIdsField(where, bulkId, entry, screenId, form);
  validateBulkIdsBounded(where, bulkId, String(entry["idsField"]), form, featureMap);
}

/** `where` is the full message prefix, e.g. `[Feature x] Screen "y" (entityList)`. */
export function validateListBulkActions(
  where: string,
  bulkActions: unknown,
  rowActions: readonly RowAction[] | undefined,
  featureName: string,
  lookups: NavigateTargetLookups,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
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
    if (opensForm) validateBulkFormTarget(where, id, entry, featureName, lookups, featureMap);
    else validateBulkActionTarget(where, id, entry["rowAction"], rowActions ?? []);
  }
}
