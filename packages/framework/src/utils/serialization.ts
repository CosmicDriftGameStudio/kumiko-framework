import { parseJsonSafe } from "./safe-json";

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((e): e is string => typeof e === "string") : [];
}

export function parseRoles(raw: unknown): string[] {
  // parseJsonSafe<string[]> is a cast, not a runtime check — `'[42, true]'`
  // would otherwise come back as `[42, true]` typed as string[]. Filter to
  // actual strings on both the parsed-JSON path and the already-an-array
  // path, so a non-string entry never survives as a "role".
  if (typeof raw === "string") return toStringArray(parseJsonSafe<unknown>(raw, []));
  return toStringArray(raw);
}
