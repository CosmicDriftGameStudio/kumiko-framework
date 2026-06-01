import type { ComplianceProfileOverride } from "@cosmicdrift/kumiko-framework/compliance";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";

export function parseComplianceProfileOverride(
  raw: string | null,
  tenantId: string,
  callerLabel: string,
): ComplianceProfileOverride | undefined {
  if (!raw || raw.trim() === "") return undefined;
  let parsed: ComplianceProfileOverride | null;
  try {
    parsed = parseJsonOrThrow<ComplianceProfileOverride | null>(raw, "compliance override");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(`[${callerLabel}] tenant ${tenantId}: stored override ignored. Reason: ${reason}`);
    return undefined;
  }
  return parsed ?? undefined;
}
