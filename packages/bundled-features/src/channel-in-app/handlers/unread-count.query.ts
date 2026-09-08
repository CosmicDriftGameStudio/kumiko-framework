import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const unreadCountQuery = defineQueryHandler({
  name: "unreadCount",
  schema: z.object({}),
  access: { openToAll: true },
  description:
    "Counts the calling user's unread in-app notification messages; use it for an inbox badge or to check whether a user has pending notifications.",
  handler: async (query, ctx) => {
    // bun-db hat keinen aggregate-helper — selectMany alle matching rows,
    // count() in JS. Pragma: unread-counts sind low-cardinality (user-
    // scoped, max ~hunderte rows). Wenn das wachsen sollte: raw .unsafe()
    // mit COUNT(*).
    const rows = await selectMany(ctx.db, inAppMessagesTable, {
      userId: query.user.id,
      isRead: false,
    });
    return { count: rows.length };
  },
});
