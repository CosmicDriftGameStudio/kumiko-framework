import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { notificationPreferencesTable } from "../tables";

export const preferencesQuery = defineQueryHandler({
  name: "preferences",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, query.user.id));

    return { rows };
  },
});
