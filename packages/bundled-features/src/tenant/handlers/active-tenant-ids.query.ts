import type { DbRow } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";

export const activeTenantIdsQuery = defineQueryHandler({
  name: "activeTenantIds",
  schema: z.object({}),
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (_query, ctx) => {
    const rows = await ctx.db
      ?.select({ id: tenantTable["id"] })
      .from(tenantTable)
      .where(eq(tenantTable["isEnabled"], true));

    return rows.map((row) => (row as DbRow)["id"] as number);
  },
});
