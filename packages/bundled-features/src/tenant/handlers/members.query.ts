import { defineQueryHandler } from "@kumiko/framework/engine";
import { parseRoles } from "@kumiko/framework/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";

export const membersQuery = defineQueryHandler({
  name: "members",
  schema: z.object({}),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      ?.select()
      .from(tenantMembershipsTable)
      .where(eq(tenantMembershipsTable.tenantId, query.user.tenantId));

    return rows.map((row) => ({
      ...row,
      roles: parseRoles(row["roles"]),
    }));
  },
});
