import type { ActionFormPreview, ActionFormScreenDefinition } from "../types/screen.ts";
import { ACTION_FORM_PREVIEW_RULES } from "./action-form-preview-rules.ts";
import { bootRuleError } from "./boot-rule.ts";

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value === "";
}

function validateSentFields(
  where: string,
  preview: ActionFormPreview,
  fieldNames: ReadonlySet<string>,
): void {
  for (const field of preview.fields ?? []) {
    if (fieldNames.has(field)) continue;
    throw bootRuleError(ACTION_FORM_PREVIEW_RULES.fieldUnknown, {
      message: `${where} sends field "${field}", which the form does not declare. Form fields: ${[...fieldNames].sort().join(", ") || "(none)"}.`,
    });
  }
}

function validateFacts(where: string, facts: NonNullable<ActionFormPreview["facts"]>): void {
  for (const fact of facts) {
    if (!isBlank(fact.label)) continue;
    throw bootRuleError(ACTION_FORM_PREVIEW_RULES.labelMissing, {
      message: `${where} fact "${fact.field}" needs label: the i18n key shown before the value.`,
    });
  }
}

function validateList(where: string, list: NonNullable<ActionFormPreview["list"]>): void {
  if (isBlank(list.field) || list.columns.length === 0) {
    throw bootRuleError(ACTION_FORM_PREVIEW_RULES.listFieldMissing, {
      message: `${where} list needs field (the array in the query result) and at least one column.`,
    });
  }
  for (const column of list.columns) {
    if (!isBlank(column.label)) continue;
    throw bootRuleError(ACTION_FORM_PREVIEW_RULES.labelMissing, {
      message: `${where} list column "${column.field}" needs label: the i18n key of its header.`,
    });
  }
}

export function validateActionFormPreview(
  featureName: string,
  screenId: string,
  screen: ActionFormScreenDefinition,
  fieldNames: ReadonlySet<string>,
): void {
  const { preview } = screen;
  // skip: no preview declared
  if (preview === undefined) return;
  const where = `[Feature ${featureName}] Screen "${screenId}" (actionForm) preview`;
  validateSentFields(where, preview, fieldNames);
  const facts = preview.facts ?? [];
  if (facts.length === 0 && preview.list === undefined) {
    throw bootRuleError(ACTION_FORM_PREVIEW_RULES.empty, {
      message: `${where} has neither facts nor list, so the panel would stay empty. Add facts: [{ field, label }] or list: { field, columns }.`,
    });
  }
  validateFacts(where, facts);
  if (preview.list !== undefined) validateList(where, preview.list);
}
