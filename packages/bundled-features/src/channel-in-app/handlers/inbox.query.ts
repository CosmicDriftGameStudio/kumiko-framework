import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const inboxQuery = defineQueryHandler({
  name: "inbox",
  schema: z.object({
    limit: z.number().min(1).max(100).default(50),
    unreadOnly: z.boolean().default(false),
  }),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const conditions = [eq(inAppMessagesTable.userId, query.user.id)];
    if (query.payload.unreadOnly) {
      conditions.push(eq(inAppMessagesTable.isRead, false));
    }

    const rows = await ctx.db
      .select()
      .from(inAppMessagesTable)
      .where(and(...conditions))
      .orderBy(desc(inAppMessagesTable.createdAt))
      .limit(query.payload.limit);

    return { rows };
  },
});
