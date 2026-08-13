import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { ComplianceProfileKey } from "@cosmicdrift/kumiko-framework/compliance";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantComplianceProfileTable } from "../schema/profile-selection";

// Onboarding banner trigger for tenant admin.
//
// Sprint 1.5 — minimal API endpoint, the UI banner comes in a later UI
// sprint. Pure read query: does an entry exist in tenantComplianceProfile
// for the current tenant?
//
// If not → tenant admin must pick a profile (mandatory during onboarding).
// Until picked, minimal-no-region runs with a warning that should surface
// in the tenant dashboard banner.
//
// Access: TenantAdmin only — the banner is only relevant to tenant admins,
// not regular members. Stays hard-coded to TenantAdmin (not the `access`
// option of createComplianceProfilesFeature) — passing the option through
// would widen call access by default to all three access.admin roles
// (including SystemAdmin). Instead the handler takes `pickerReachableRoles`
// and deliberately resolves the #2063 special case: if the *caller's*
// roles no longer intersect the picker's `access` option, the query stops
// reporting needsSelection — otherwise a tenant admin would be told to
// open a screen they can't reach.
export function createNeedsProfileQuery(pickerReachableRoles: readonly string[]) {
  return defineQueryHandler({
    name: "needs-profile",
    schema: z.object({}),
    access: { roles: [ROLES.TenantAdmin] },
    handler: async (query, ctx): Promise<NeedsProfileResponse> => {
      const row = (await fetchOne(ctx.db, tenantComplianceProfileTable, {
        tenantId: query.user.tenantId,
      })) as { profileKey: ComplianceProfileKey } | null; // @cast-boundary db-runner

      if (row) {
        // S1.7 X1: minimal-no-region is no longer settable via set-profile
        // (Zod). If Sprint 2 ships a seedComplianceProfile helper that
        // reintroduces the migration edge case, a defensive path belongs
        // here again — until then, every existing entry is a deliberately
        // chosen production profile.
        return {
          needsSelection: false,
          currentProfile: row.profileKey,
        };
      }

      const callerCanReachPicker = query.user.roles.some((role) =>
        pickerReachableRoles.includes(role),
      );
      if (!callerCanReachPicker) {
        return {
          needsSelection: false,
          currentProfile: null,
          reason: "picker_not_accessible_for_role",
        };
      }

      return {
        needsSelection: true,
        currentProfile: null,
        reason: "no_profile_selected",
      };
    },
  });
}

interface NeedsProfileResponse {
  readonly needsSelection: boolean;
  readonly currentProfile: ComplianceProfileKey | null;
  readonly reason?: "no_profile_selected" | "picker_not_accessible_for_role";
}
