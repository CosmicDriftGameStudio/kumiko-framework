import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { tenantMembershipsTable } from "../membership-table";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";

export const membershipsQuery = defineQueryHandler({
  name: "memberships",
  schema: z.object({ userId: z.string() }),
  // Called via ctx.queryAs(systemUser, ...) during login/switch-tenant, or
  // directly by tenant admins managing memberships in the admin UI.
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await selectMany(ctx.db, tenantMembershipsTable, { userId: query.payload.userId });

    return rows.map((row) => ({
      ...row,
      roles: parseRoles(row["roles"]),
    }));
  },
});
