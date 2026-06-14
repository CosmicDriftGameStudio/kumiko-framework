import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
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
    const rows = await selectMany(ctx.db, tenantMembershipsTable, { userId: query.payload.userId });
    if (rows.length === 0) return [];

    // tenantName/tenantKey machen Memberships im UI unterscheidbar (sonst nur
    // das UUID-Präfix — Seed-Tenants mit 00000000-…-Präfix wären ununterscheidbar).
    // Ein einzelner IN-Batch über alle tenantIds statt fetchOne pro Membership (#324).
    type TenantRow = { id: unknown; name?: unknown; key?: unknown; isEnabled?: unknown };
    const tenants = await selectMany<TenantRow>(ctx.db, tenantTable, {
      id: rows.map((row) => row["tenantId"]),
    });
    const tenantById = new Map<unknown, TenantRow>(tenants.map((t) => [t.id, t]));

    return rows
      .map((row) => {
        const tenant = tenantById.get(row["tenantId"]);
        // Disabled Tenants (tenant:write:disable) zählen nicht als Membership:
        // Login wählt sie nicht, /auth/tenants listet sie nicht, switch-tenant
        // antwortet not_a_member. Nur das explizite false filtert — eine
        // fehlende tenant-Row (Projektions-Drift) soll keinen Login-Lockout
        // aller Member auslösen.
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
