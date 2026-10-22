import { selectMany } from "@cosmicdrift/kumiko-framework/db";
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
    // The query helpers in db/query.ts have no aggregate helper, so selectMany returns all matching
    // rows and count() runs in JS. This is acceptable because unread counts are low-cardinality and
    // user-scoped, with at most a few hundred rows; use raw .unsafe() with COUNT(*) if that grows.
    const rows = await selectMany(ctx.db, inAppMessagesTable, {
      userId: query.user.id,
      isRead: false,
    });
    return { count: rows.length };
  },
});
