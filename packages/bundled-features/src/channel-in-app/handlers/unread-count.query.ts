import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { inAppMessagesTable } from "../tables.ts";

export const unreadCountQuery = defineQueryHandler({
  name: "unreadCount",
  schema: z.object({}),
  access: {
    openToAll: {
      reason:
        "each signed-in user counts only their own unread in-app messages; the query " +
        "filters inAppMessagesTable by the caller's own id",
    },
  },
  description:
    "Counts the calling user's unread in-app notification messages; use it for an inbox badge or to check whether a user has pending notifications.",
  handler: async (query, ctx) => {
    const [countRow] = await ctx.db.aggregate(
      inAppMessagesTable,
      { measure: { fn: "count" } },
      { userId: query.user.id, isRead: false },
    );
    return { count: countRow?.value ?? 0 };
  },
});
