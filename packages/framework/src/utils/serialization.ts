import { parseJsonSafe } from "./safe-json";

export function parseRoles(raw: unknown): string[] {
  if (typeof raw === "string") return parseJsonSafe<string[]>(raw, []);
  if (Array.isArray(raw)) return raw;
  return [];
}
