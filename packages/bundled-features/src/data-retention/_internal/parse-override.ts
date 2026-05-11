// Geteilter Override-Parser fuer policy-for-Query und resolve-for-tenant-
// Helper. War vorher 1:1 in beiden Files dupliziert (Memory
// `feedback_bulk_patterns` — Drift-Risiko bei Schema-Aenderungen).

import { retentionOverrideSchema } from "../override-schema";
import type { RetentionOverride } from "../resolver";

export function parseRetentionOverrideOrNull(
  raw: string | null,
  tenantId: string,
  callerLabel: string,
): RetentionOverride | null {
  if (!raw || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(
      `[${callerLabel}] tenant ${tenantId}: stored override is not valid JSON, ignoring. Reason: ${(e as Error).message}`,
    );
    return null;
  }
  const validation = retentionOverrideSchema.safeParse(parsed);
  if (!validation.success) {
    // biome-ignore lint/suspicious/noConsole: operator visibility for schema-drift
    console.warn(
      `[${callerLabel}] tenant ${tenantId}: stored override fails schema validation, ignoring. Issue: ${validation.error.issues[0]?.path.join(".")}: ${validation.error.issues[0]?.message}`,
    );
    return null;
  }
  return validation.data;
}
