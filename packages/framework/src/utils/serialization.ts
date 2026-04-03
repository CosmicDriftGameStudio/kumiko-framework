export function parseRoles(raw: unknown): string[] {
  if (typeof raw === "string") return JSON.parse(raw);
  if (Array.isArray(raw)) return raw;
  return [];
}
