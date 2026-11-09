import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta.ts";
import type { normalizeListColumn } from "../screen-helpers.ts";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_SCREEN_RULES } from "./screens-lists-rules.ts";

const DATE_FIELD_TYPES: readonly string[] = ["timestamp", "date", "locatedTimestamp"];

// Mirrors how the list view-model types a column: stored field, then derived field, then row meta.
export function entityColumnType(entity: EntityDefinition, field: string): string | undefined {
  return (
    entity.fields[field]?.type ??
    entity.derivedFields?.[field]?.valueType ??
    LIST_ROW_META_COLUMNS[field]
  );
}

// `entityType` is the column's type on a known entity; without one only the column's own
// `valueType` is known, and a column without any type information stays allowed.
export function validateDateOnlyAfterDays(
  prefix: string,
  column: ReturnType<typeof normalizeListColumn>,
  entityType: string | undefined,
): void {
  const days = column.dateOnlyAfterDays;
  if (days === undefined) return;
  const where = `${prefix} column "${column.field}"`;
  if (!Number.isInteger(days) || days < 0) {
    throw bootRuleError(LIST_SCREEN_RULES.dateOnlyAfterDaysInvalid, {
      message: `${where} sets dateOnlyAfterDays to ${String(days)}, which is not a non-negative whole number of days. Use 0 or a positive integer.`,
    });
  }
  if (propertyOf(column.renderer, "format") === "relativeTime") return;
  const type = entityType ?? column.valueType;
  if (type === undefined || DATE_FIELD_TYPES.includes(type)) return;
  throw bootRuleError(LIST_SCREEN_RULES.dateOnlyAfterDaysWrongType, {
    message: `${where} sets dateOnlyAfterDays on a ${type} column. It only applies to timestamp, locatedTimestamp or date fields and relativeTime columns; remove it.`,
  });
}
