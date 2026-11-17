import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";
import { ticketExecutor } from "../schema/ticket";

export const ticketRowsQuery = defineQueryHandler({
  name: "ticket:rows",
  schema: z.object({}),
  handler: async (query, ctx) => {
    const page = await ticketExecutor.list({ limit: 50 }, query.user, ctx.db);
    return { rows: page.rows, nextCursor: null };
  },
  access: readerRoles,
});
