import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
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

    // tenantName/tenantKey machen Memberships in der UI unterscheidbar
    // (Tenant-Switcher zeigte sonst nur das UUID-Präfix — bei Seed-Tenants
    // mit 00000000-…-Präfix sind die ununterscheidbar). Eine Handvoll
    // Memberships pro User → Einzel-Fetches sind ok.
    return Promise.all(
      rows.map(async (row) => {
        const tenant = await fetchOne<{ name?: unknown; key?: unknown }>(ctx.db, tenantTable, {
          id: row["tenantId"],
        });
        return {
          ...row,
          roles: parseRoles(row["roles"]),
          ...(typeof tenant?.name === "string" && { tenantName: tenant.name }),
          ...(typeof tenant?.key === "string" && { tenantKey: tenant.key }),
        };
      }),
    );
  },
});
