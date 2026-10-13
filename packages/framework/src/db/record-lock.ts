import type { FieldCondition } from "../engine/index.js";
import { evalFieldCondition } from "../engine/screen-helpers.js";

// A row that lacks the condition's field counts as locked: an unreadable lock state
// must not open the record.
export function isRecordLocked(
  lockedWhen: FieldCondition | undefined,
  row: Readonly<Record<string, unknown>>,
): boolean {
  if (lockedWhen === undefined) return false;
  if (typeof lockedWhen === "object" && !(lockedWhen.field in row)) return true;
  return evalFieldCondition(lockedWhen, row);
}
