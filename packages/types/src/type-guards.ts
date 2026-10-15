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

/** Reads one property off an unknown value (object or function); undefined for primitives, null and absent keys. */
export function propertyOf(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}
