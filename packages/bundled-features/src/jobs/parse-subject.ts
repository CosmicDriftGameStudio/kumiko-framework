import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

function isSubjectEntry(value: unknown): value is [string, unknown] {
  return Array.isArray(value) && typeof value[0] === "string";
}

// A corrupt subject must not fail the whole list: the record still tells the
// tenant which job failed. parseJsonSafe only survives a SyntaxError, so the
// shape needs its own check.
export function parseSubject(stored: string | null): Record<string, unknown> | null {
  if (stored === null) return null;
  const parsed = parseJsonSafe<unknown>(stored, null);
  if (!Array.isArray(parsed)) return null;
  return Object.fromEntries(parsed.filter(isSubjectEntry));
}
