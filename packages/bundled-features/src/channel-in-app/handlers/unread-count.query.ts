import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const unreadCountQuery = defineQueryHandler({
  name: "unreadCount",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      .select({ value: count() })
      .from(inAppMessagesTable)
      .where(
        and(eq(inAppMessagesTable.userId, query.user.id), eq(inAppMessagesTable.isRead, false)),
      );

    return { count: rows[0]?.["value"] ?? 0 };
  },
});
