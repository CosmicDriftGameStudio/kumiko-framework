import type { FieldCondition } from "@cosmicdrift/kumiko-types/screen";
import { bootRuleError } from "./boot-rule.ts";
import { FIELD_CONDITION_RULES } from "./field-conditions-rules.ts";

/** Rejects an `all` with fewer than two entries at any nesting depth: a one-entry `all` is the
 *  entry itself and an empty one is vacuously true, which hides a forgotten condition. */
export function assertConditionShape(where: string, condition: FieldCondition): void {
  if (typeof condition === "boolean" || !("all" in condition)) return;
  if (condition.all.length < 2) {
    throw bootRuleError(FIELD_CONDITION_RULES.allNeedsTwoConditions, {
      message: `${where} has an "all" condition with ${condition.all.length} entries. List at least two conditions, or use the single condition directly.`,
    });
  }
  for (const part of condition.all) assertConditionShape(where, part);
}
