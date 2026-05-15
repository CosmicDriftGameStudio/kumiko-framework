import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { ComplianceProfileKey } from "@cosmicdrift/kumiko-framework/compliance";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
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
    )) as { profileKey: ComplianceProfileKey } | null; // @cast-boundary db-runner

    if (!row) {
      return {
        needsSelection: true,
        currentProfile: null,
        reason: "no_profile_selected",
      };
    }

    // S1.7 X1: minimal-no-region ist via set-profile (Zod) nicht mehr
    // setzbar. Wenn Sprint 2 einen seedComplianceProfile-Helper liefert
    // der den Migration-Edge-Case einführt, kommt hier wieder ein
    // defensiver Pfad rein — bis dahin: jeder existierende Eintrag ist
    // ein bewusst gewähltes Production-Profile.
    return {
      needsSelection: false,
      currentProfile: row.profileKey,
    };
  },
});

interface NeedsProfileResponse {
  readonly needsSelection: boolean;
  readonly currentProfile: ComplianceProfileKey | null;
  readonly reason?: "no_profile_selected";
}
