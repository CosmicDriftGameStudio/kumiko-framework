import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";
import { tenantTable } from "../schema/tenant";

export const membershipsQuery = defineQueryHandler({
  name: "memberships",
  schema: z.object({ userId: z.string() }),
  // Called via ctx.queryAs(systemUser, ...) during login/switch-tenant, or
  // directly by tenant admins managing memberships in the admin UI.
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:memberships requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "resolves memberships for an arbitrary userId across all tenants",
    );
    const rows = await selectMany(db, tenantMembershipsTable, { userId: query.payload.userId });
    if (rows.length === 0) return [];

    // tenantName/tenantKey make memberships distinguishable in the UI
    // (otherwise just the UUID prefix — seed tenants with a 00000000-…
    // prefix would be indistinguishable). A single IN-batch over all
    // tenantIds instead of fetchOne per membership (#324).
    type TenantRow = { id: unknown; name?: unknown; key?: unknown; isEnabled?: unknown };
    const tenants = await selectMany<TenantRow>(db, tenantTable, {
      id: rows.map((row) => row["tenantId"]),
    });
    const tenantById = new Map<unknown, TenantRow>(tenants.map((t) => [t.id, t]));

    return rows
      .map((row) => {
        const tenant = tenantById.get(row["tenantId"]);
        // Disabled tenants (tenant:write:disable) don't count as a
        // membership: login doesn't pick them, /auth/tenants doesn't list
        // them, switch-tenant answers not_a_member. Only the explicit
        // false filters — a missing tenant row (projection drift) should
        // not lock out every member's login.
        if (tenant !== undefined && tenant.isEnabled === false) return null;
        return {
          ...row,
          roles: parseRoles(row["roles"]),
          ...(typeof tenant?.name === "string" && { tenantName: tenant.name }),
          ...(typeof tenant?.key === "string" && { tenantKey: tenant.key }),
        };
      })
      .filter((m) => m !== null);
  },
});
