import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";

export const membershipsQuery = defineQueryHandler({
  name: "memberships",
  schema: z.object({ userId: z.string() }),
  // Called via ctx.queryAs(systemUser, ...) during login/switch-tenant, or
  // directly by tenant admins managing memberships in the admin UI.
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      ?.select()
      .from(tenantMembershipsTable)
      .where(eq(tenantMembershipsTable.userId, query.payload.userId));

    return rows.map((row) => ({
      ...row,
      roles: parseRoles(row["roles"]),
    }));
  },
});
