import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  type ComplianceProfileKey,
  type ComplianceProfileOverride,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
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

    const override = parseOverride(row.override);
    return resolveComplianceProfile({
      selection: row.profileKey as ComplianceProfileKey,
      override,
      // isProduction-Marker kommt ggf. ueber config-key in spaeterem Sprint;
      // jetzt: minimal-no-region zeigt nur das "no-profile-selected"-warning
      // wenn keine Wahl da ist, kein "minimal-in-production".
      isProduction: false,
    });
  },
});

function parseOverride(raw: string | null): ComplianceProfileOverride | undefined {
  if (!raw || raw.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as ComplianceProfileOverride;
    return parsed;
  } catch {
    // Defensiv: ungültiges JSON wird als "kein Override" behandelt. Im
    // set-profile-Handler validiert Zod das Override schon — invalides
    // JSON in der DB ist also nur möglich bei manueller DB-Manipulation
    // oder Migration-Bug. Resolver-Caller darf trotzdem nicht crashen.
    return undefined;
  }
}
