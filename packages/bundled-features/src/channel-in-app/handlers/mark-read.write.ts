import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
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
    const rows = await updateMany(
      ctx.db,
      inAppMessagesTable,
      { isRead: true, readAt: Temporal.Now.instant() },
      { id: event.payload.id, userId: event.user.id },
    );
    if (rows.length === 0) {
      return writeFailure(new NotFoundError("inAppMessage", event.payload.id));
    }
    return { isSuccess: true, data: { id: (rows[0] as { id: number } | undefined)?.id } };
  },
});
