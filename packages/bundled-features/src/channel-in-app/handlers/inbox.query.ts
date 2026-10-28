import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { parseStoredNotificationData, targetOfNotificationData } from "../in-app-target.ts";
import { inAppMessagesTable } from "../tables.ts";

const SERIAL_ID_PATTERN = /^\d{1,15}$/;

export const inboxQuery = defineQueryHandler({
  name: "inbox",
  schema: z.object({
    limit: z.number().min(1).max(100).default(50),
    unreadOnly: z.boolean().default(false),
    cursor: z.string().regex(SERIAL_ID_PATTERN).optional(),
  }),
  access: {
    openToAll: {
      reason:
        "each signed-in user reads only their own in-app inbox; the query filters " +
        "inAppMessagesTable by the caller's own id",
    },
  },
  description:
    "Lists the calling user's own in-app notification messages newest-first with a parsed navigation target, optionally only the unread ones. Pass the returned nextCursor as cursor for the next page; total counts all matching messages, not just the page. Use it to show or inspect a user's notification inbox.",
  handler: async (query, ctx) => {
    const { limit, unreadOnly, cursor } = query.payload;
    const ownMessages: Record<string, unknown> = { userId: query.user.id };
    if (unreadOnly) ownMessages["isRead"] = false;

    const pageWhere =
      cursor === undefined ? ownMessages : { ...ownMessages, id: { lt: Number(cursor) } };
    // One extra row tells whether another page exists without a second query.
    const fetched = await selectMany(ctx.db, inAppMessagesTable, pageWhere, {
      limit: limit + 1,
      orderBy: { col: "id", direction: "desc" },
    });
    const page = fetched.slice(0, limit);
    const lastRow = page[page.length - 1];
    const nextCursor = fetched.length > limit && lastRow ? String(lastRow["id"]) : null;

    const [totalRow] = await ctx.db.aggregate(
      inAppMessagesTable,
      { measure: { fn: "count" } },
      ownMessages,
    );

    const rows = page.map((row) => {
      const storedData = row["data"];
      const data = parseStoredNotificationData(typeof storedData === "string" ? storedData : null);
      return { ...row, target: targetOfNotificationData(data) };
    });
    return { rows, nextCursor, total: totalRow?.value ?? 0 };
  },
});
