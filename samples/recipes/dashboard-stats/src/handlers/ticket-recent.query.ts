import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";
import { ticketExecutor } from "../schema/ticket";

// Three newest rows plus the total, so the panel can say how many more exist.
export const ticketRecentQuery = defineQueryHandler({
  name: "ticket:recent",
  schema: z.object({}),
  handler: async (query, ctx) => {
    const page = await ticketExecutor.list({ limit: 3, totalCount: true }, query.user, ctx.db);
    return { rows: page.rows, nextCursor: null, total: page.total ?? page.rows.length };
  },
  access: readerRoles,
});
