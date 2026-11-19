import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";
import { countTicketsWithStatus } from "../lib/count-tickets-with-status";

// Flat result: each dashboard stat reads one field via its valueField.
// limit: 1 keeps the page tiny; totalCount counts over the whole WHERE in
// the database, so no rows are loaded just to be counted.
export const ticketStatsQuery = defineQueryHandler({
  name: "ticket:stats",
  schema: z.object({}),
  handler: async (query, ctx) => {
    const [open, closed] = await Promise.all([
      countTicketsWithStatus("open", query.user, ctx.db),
      countTicketsWithStatus("closed", query.user, ctx.db),
    ]);
    return { open, closed, total: open + closed };
  },
  access: readerRoles,
});
