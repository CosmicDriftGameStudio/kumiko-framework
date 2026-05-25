import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type ComplianceProfileKey,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { parseComplianceProfileOverride } from "../_internal/parse-override";
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
    const row = (await fetchOne(ctx.db, tenantComplianceProfileTable, {
      tenantId: query.user.tenantId,
    })) as { profileKey: string; override: string | null } | null; // @cast-boundary db-runner

    if (!row) {
      return resolveComplianceProfile({});
    }

    const override = parseComplianceProfileOverride(
      row.override,
      query.user.tenantId,
      "compliance-profiles:for-tenant",
    );
    return resolveComplianceProfile({
      selection: row.profileKey as ComplianceProfileKey, // @cast-boundary engine-payload
      override,
    });
  },
});
