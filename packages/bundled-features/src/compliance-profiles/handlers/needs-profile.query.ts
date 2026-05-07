import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { ComplianceProfileKey } from "@cosmicdrift/kumiko-framework/compliance";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantComplianceProfileTable } from "../schema/profile-selection";

// Onboarding-Banner-Trigger fuer Tenant-Admin.
//
// Sprint 1.5 — minimaler API-Endpoint, UI-Banner kommt in einem
// spaeteren UI-Sprint. Reine Read-Query: gibt es einen Eintrag in
// tenantComplianceProfile fuer den aktuellen Tenant?
//
// Wenn nein → Tenant-Admin muss Profile waehlen (Pflicht beim
// Onboarding). Bis zur Wahl laeuft minimal-no-region mit warning,
// das in der Tenant-Dashboard-Banner sichtbar gemacht werden soll.
//
// Access: TenantAdmin only — der Banner ist nur fuer Tenant-Admins
// relevant, nicht fuer normale Member.
export const needsProfileQuery = defineQueryHandler({
  name: "needs-profile",
  schema: z.object({}),
  access: { roles: [ROLES.TenantAdmin] },
  handler: async (query, ctx): Promise<NeedsProfileResponse> => {
    const row = (await fetchOne(
      ctx.db,
      tenantComplianceProfileTable,
      eq(tenantComplianceProfileTable["tenantId"], query.user.tenantId),
    )) as { profileKey: ComplianceProfileKey } | null;

    if (!row) {
      return {
        needsSelection: true,
        currentProfile: null,
        reason: "no-profile-selected",
      };
    }

    if (row.profileKey === "minimal-no-region") {
      // Defensive: ueber set-profile (S1.7 X1) nicht mehr setzbar, aber
      // Migration-Edge-Case oder DB-Direct-Insert koennten den State
      // erzeugen. Banner auf "needs selection" damit Tenant-Admin weiss
      // dass er waehlen muss.
      return {
        needsSelection: true,
        currentProfile: "minimal-no-region",
        reason: "minimal-not-production-ready",
      };
    }

    return {
      needsSelection: false,
      currentProfile: row.profileKey,
    };
  },
});

interface NeedsProfileResponse {
  readonly needsSelection: boolean;
  readonly currentProfile: ComplianceProfileKey | null;
  readonly reason?: "no-profile-selected" | "minimal-not-production-ready";
}
