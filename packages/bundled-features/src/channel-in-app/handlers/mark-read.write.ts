import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inAppMessagesTable } from "../tables";

export const markReadWrite = defineWriteHandler({
  name: "markRead",
  schema: z.object({
    // inAppMessages.id is a serial integer (table is infra, not an ES aggregate).
    id: z.number().int(),
  }),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const rows = await ctx.db
      .update(inAppMessagesTable)
      .set({ isRead: true, readAt: Temporal.Now.instant() })
      .where(
        and(
          eq(inAppMessagesTable.id, event.payload.id),
          eq(inAppMessagesTable.userId, event.user.id),
        ),
      )
      .returning();

    if (rows.length === 0) {
      return writeFailure(new NotFoundError("inAppMessage", event.payload.id));
    }

    return { isSuccess: true, data: { id: rows[0]?.["id"] } };
  },
});
