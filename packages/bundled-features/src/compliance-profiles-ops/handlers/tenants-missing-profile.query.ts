import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { defineQueryHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantComplianceProfileTable } from "../../compliance-profiles";
import { tenantTable } from "../../tenant";

// SystemAdmin platform-wide counterpart to needs-profile (#2089).
//
// #2084 stopped needs-profile from nagging a TenantAdmin who can no longer
// reach a picker narrowed to access.systemAdmin — correct, but it left no
// one else able to notice: needs-profile stays TenantAdmin-only on purpose
// (widening its call-access was explicitly rejected in #2084), so a
// SystemAdmin who owns the platform-only picker has no way to see which
// tenants still run on minimal-no-region. This query fills that gap
// instead of touching needs-profile: every enabled tenant that has no row
// in tenantComplianceProfile at all, tenant-wide rather than for the
// caller's own tenant.
export const tenantsMissingProfileQuery = defineQueryHandler({
  name: "tenants-missing-profile",
  schema: z.object({}),
  access: { roles: [ROLES.SystemAdmin] },
  handler: async (_query, ctx): Promise<TenantsMissingProfileResponse> => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "[compliance-profiles-ops] tenants-missing-profile requires ctx.systemDb — the " +
          "compliance-profiles-ops feature must stay r.systemScope() (see feature.ts).",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "platform operator scans every tenant for a missing compliance-profile selection",
    );

    const tenants = await db.selectMany<{ id: TenantId; name: string }>(tenantTable, {
      isEnabled: true,
    });
    const profileRows = await db.selectMany<{ tenantId: TenantId }>(
      tenantComplianceProfileTable,
      {},
    );
    const tenantIdsWithProfile = new Set(profileRows.map((row) => row.tenantId));

    return {
      tenants: tenants
        .filter((tenant) => !tenantIdsWithProfile.has(tenant.id))
        .map((tenant) => ({ id: tenant.id, name: tenant.name })),
    };
  },
});

interface TenantsMissingProfileResponse {
  readonly tenants: readonly { readonly id: TenantId; readonly name: string }[];
}
