import {
  type ComplianceProfileKey,
  type EffectiveComplianceProfile,
  resolveComplianceProfile,
} from "@cosmicdrift/kumiko-framework/compliance";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { parseComplianceProfileOverride } from "../_internal/parse-override.ts";
import { tenantComplianceProfileTable } from "../schema/profile-selection.ts";

// Returns the effective compliance profile for the current tenant.
//
// If no profile is selected, returns minimal-no-region with
// warning="no-profile-selected" so callers can trigger an onboarding banner.
export const forTenantQuery = defineQueryHandler({
  name: "for-tenant",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "any signed-in tenant member may read their own tenant's effective compliance " +
        "profile; the result carries policy metadata, never PII",
    },
  },
  description:
    "Returns the effective compliance profile for the caller's tenant with any tenant override merged in, falling back to minimal-no-region plus a no-profile-selected warning when the tenant has not picked one yet.",
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
