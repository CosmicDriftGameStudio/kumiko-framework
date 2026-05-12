import {
  type ComplianceProfileKey,
  type ComplianceProfileOverride,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantComplianceProfileTable } from "../schema/profile-selection";

// Liefert das effektive Compliance-Profile fuer den aktuellen Tenant.
// Macht den exposesApi-Marker aus feature.ts mit echtem Inhalt.
//
// Default-Verhalten (Edge-Case-Decision aus S1.1): kein Profile-
// Eintrag → minimal-no-region + warning="no-profile-selected".
// Caller (z.B. user-data-rights in Sprint 2) sieht das warning und
// kann Onboarding-Banner triggern.
export const forTenantQuery = defineQueryHandler({
  name: "for-tenant",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx): Promise<EffectiveComplianceProfile> => {
    const row = (await fetchOne(
      ctx.db,
      tenantComplianceProfileTable,
      eq(tenantComplianceProfileTable["tenantId"], query.user.tenantId),
    )) as { profileKey: string; override: string | null } | null;

    if (!row) {
      return resolveComplianceProfile({});
    }

    const override = parseOverride(row.override, query.user.tenantId);
    return resolveComplianceProfile({
      selection: row.profileKey as ComplianceProfileKey,
      override,
    });
  },
});

function parseOverride(
  raw: string | null,
  tenantId: string,
): ComplianceProfileOverride | undefined {
  if (!raw || raw.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed as ComplianceProfileOverride; // @cast-boundary engine-payload
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    // Defensiv: ungültiges JSON wird als "kein Override" behandelt. Der
    // set-profile-Handler validiert Zod das Override schon — invalides
    // JSON in der DB ist also nur möglich bei manueller DB-Manipulation
    // oder Migration-Bug. Resolver-Caller darf trotzdem nicht crashen.
    // Operator-Sichtbarkeit via console.warn — Telemetry-Hook spaeter.
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(
      `[compliance-profiles:for-tenant] tenant ${tenantId}: stored override is not valid JSON, falling back to base profile. Reason: ${reason}`,
    );
    return undefined;
  }
}
