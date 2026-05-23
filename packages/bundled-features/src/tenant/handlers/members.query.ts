import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";

export const membersQuery = defineQueryHandler({
  name: "members",
  schema: z.object({}),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await selectMany(ctx.db, tenantMembershipsTable, { tenantId: query.user.tenantId });

    return rows.map((row) => ({
      ...row,
      roles: parseRoles(row["roles"]),
    }));
  },
});
