/** Non-null object that is not an array — shared guard for deep-merge and AST extractors. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Membership test that narrows `candidate` to the element union of a const tuple. */
export function isOneOf<const T extends readonly unknown[]>(
  values: T,
  candidate: unknown,
): candidate is T[number] {
  return values.some((value) => value === candidate);
}

/** Reads a string `code` (e.g. Node `ErrnoException`, Postgres SQLSTATE) off an unknown thrown value. */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
