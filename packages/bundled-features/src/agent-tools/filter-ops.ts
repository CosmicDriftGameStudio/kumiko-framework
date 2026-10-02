export const FILTER_OPS = ["eq", "ne", "lt", "gt", "lte", "gte", "in"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
