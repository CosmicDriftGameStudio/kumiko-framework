import { parseJsonSafe } from "./safe-json";

/** Parses a JSON-encoded string array from DB/cache columns; returns fallback on invalid input. */
export function parseStringArrayJson(
  raw: string,
  fallback: readonly string[] = [],
): readonly string[] {
  const parsed = parseJsonSafe<unknown>(raw, null);
  if (parsed === null) return fallback;
  if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
    return parsed;
  }
  return fallback;
}
