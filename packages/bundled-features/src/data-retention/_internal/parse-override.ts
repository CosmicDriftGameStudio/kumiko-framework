// Shared override parser for policy-for-Query and the resolve-for-tenant helper. It was
// duplicated 1:1 in both files, so schema changes could make the copies drift.

import { retentionOverrideSchema } from "../override-schema.ts";
import type { RetentionOverride } from "../resolver.ts";

export function parseRetentionOverrideOrNull(
  raw: string | null,
  tenantId: string,
  callerLabel: string,
): RetentionOverride | null {
  if (!raw || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(
      `[${callerLabel}] tenant ${tenantId}: stored override is not valid JSON, ignoring. Reason: ${reason}`,
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
