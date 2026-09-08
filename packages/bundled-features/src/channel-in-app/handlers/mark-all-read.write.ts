import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const markAllReadWrite = defineWriteHandler({
  name: "markAllRead",
  schema: z.object({}),
  access: { openToAll: true },
  description:
    "Marks every unread in-app message of the calling user as read and returns how many rows were touched; use it for a mark-all-as-read action.",
  handler: async (event, ctx) => {
    const rows = await updateMany(
      ctx.db,
      inAppMessagesTable,
      { isRead: true, readAt: Temporal.Now.instant() },
      { userId: event.user.id, isRead: false },
    );
    return { isSuccess: true, data: { marked: rows.length } };
  },
});
