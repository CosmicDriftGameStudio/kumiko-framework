import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const markAllReadWrite = defineWriteHandler({
  name: "markAllRead",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const rows = await ctx.db
      .update(inAppMessagesTable)
      .set({ isRead: true, readAt: Temporal.Now.instant() })
      .where(
        and(eq(inAppMessagesTable.userId, event.user.id), eq(inAppMessagesTable.isRead, false)),
      )
      .returning();

    return { isSuccess: true, data: { marked: rows.length } };
  },
});
