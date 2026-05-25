/** Non-null object that is not an array — shared guard for deep-merge and AST extractors. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
