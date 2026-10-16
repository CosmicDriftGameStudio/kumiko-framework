// @runtime client
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { TemplateListRow, TemplateScope } from "./types.js";

/**
 * The row the editor works on. A tenant sees its own customisation, or the
 * system row as the starting point for one; a SystemAdmin edits the system row.
 */
export function pickRow(
  rows: readonly TemplateListRow[],
  slug: string,
  locale: string,
  scope: TemplateScope,
): TemplateListRow | undefined {
  const candidates = rows.filter((row) => row.slug === slug && row.locale === locale);
  if (scope === "system") return candidates.find((row) => row.scope === "system");
  return (
    candidates.find((row) => row.scope === "tenant") ??
    candidates.find((row) => row.scope === "system")
  );
}

export function localesOf(rows: readonly TemplateListRow[], slug: string): readonly string[] {
  return [...new Set(rows.filter((row) => row.slug === slug).map((row) => row.locale))].sort();
}

export function resolveLocale(requested: string | undefined, available: readonly string[]): string {
  if (requested !== undefined && requested !== "") return requested;
  if (available.includes("de") || available.length === 0) return "de";
  return available[0] ?? "de";
}

export function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
