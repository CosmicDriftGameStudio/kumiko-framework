import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";
import { countTicketsWithStatus } from "../lib/count-tickets-with-status";
import { ticketExecutor } from "../schema/ticket";

// One query feeds every panel of the overview screen: each panel reads one field through
// `resultField`, so the screen loads with one request.
export const ticketOverviewQuery = defineQueryHandler({
  name: "ticket:overview",
  schema: z.object({}),
  outputSchema: z.object({
    stats: z.object({ open: z.number(), closed: z.number(), total: z.number() }),
    recent: z.object({
      rows: z.array(z.object({ id: z.string(), title: z.string(), status: z.string() })),
      nextCursor: z.null(),
      total: z.number(),
    }),
  }),
  handler: async (query, ctx) => {
    const [open, closed, recent] = await Promise.all([
      countTicketsWithStatus("open", query.user, ctx.db),
      countTicketsWithStatus("closed", query.user, ctx.db),
      ticketExecutor.list({ limit: 3, totalCount: true }, query.user, ctx.db),
    ]);
    return {
      stats: { open, closed, total: open + closed },
      recent: {
        rows: recent.rows.map((row) => ({
          id: String(row.id),
          title: String(row.title),
          status: String(row.status),
        })),
        nextCursor: null,
        total: recent.total ?? recent.rows.length,
      },
    };
  },
  access: readerRoles,
});
