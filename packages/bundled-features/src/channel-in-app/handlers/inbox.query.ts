import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const inboxQuery = defineQueryHandler({
  name: "inbox",
  schema: z.object({
    limit: z.number().min(1).max(100).default(50),
    unreadOnly: z.boolean().default(false),
  }),
  access: { openToAll: true },
  description:
    "Lists the calling user's own in-app notification messages newest-first, optionally only the unread ones; use it to show or inspect a user's notification inbox.",
  handler: async (query, ctx) => {
    const where: Record<string, unknown> = { userId: query.user.id };
    if (query.payload.unreadOnly) where["isRead"] = false;
    const rows = await selectMany(ctx.db, inAppMessagesTable, where, {
      limit: query.payload.limit,
      orderBy: { col: "createdAt", direction: "desc" },
    });
    return { rows };
  },
});
