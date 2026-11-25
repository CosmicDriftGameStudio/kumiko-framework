import { normalizeEditField } from "../screen-helpers.ts";
import type { EditFieldSpec } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { FORM_LAYOUT_RULES } from "./screens-forms-layout-rules.ts";

export function rejectFieldActions(
  featureName: string,
  screenId: string,
  context: string,
  fieldSpec: EditFieldSpec,
): void {
  const normalized = normalizeEditField(fieldSpec);
  if (normalized.actions === undefined) return;
  throw bootRuleError(FORM_LAYOUT_RULES.fieldActionsUnsupported, {
    message:
      `[Feature ${featureName}] Screen "${screenId}" (${context}) field "${normalized.field}" sets actions, ` +
      `but field actions exist only on projectionDetail fields sections. Remove actions or move the field.`,
  });
}
