import { defineQueryHandler } from "@kumiko/framework/engine";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { deliveryLogTable } from "../tables";

export const logQuery = defineQueryHandler({
  name: "log",
  schema: z.object({
    limit: z.number().min(1).max(100).default(50),
  }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      .select()
      .from(deliveryLogTable)
      .orderBy(desc(deliveryLogTable.createdAt))
      .limit(query.payload.limit);

    return { rows };
  },
});
