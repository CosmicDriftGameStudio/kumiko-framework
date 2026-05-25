import type { ComplianceProfileOverride } from "@cosmicdrift/kumiko-framework/compliance";
import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

export function parseComplianceProfileOverride(
  raw: string | null,
  tenantId: string,
  callerLabel: string,
): ComplianceProfileOverride | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const parsed = parseJsonSafe<ComplianceProfileOverride | null>(raw, null);
  if (parsed === null) {
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(
      `[${callerLabel}] tenant ${tenantId}: stored override is not valid JSON, ignoring.`,
    );
    return undefined;
  }
  return parsed;
}
