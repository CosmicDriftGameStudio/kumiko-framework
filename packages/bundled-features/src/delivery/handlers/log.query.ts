import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { deliveryAttemptsTable } from "../tables";

export const logQuery = defineQueryHandler({
  name: "log",
  schema: z.object({
    limit: z.number().min(1).max(100).default(50),
  }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      .select()
      .from(deliveryAttemptsTable)
      .orderBy(desc(deliveryAttemptsTable.createdAt))
      .limit(query.payload.limit);

    return { rows };
  },
});
