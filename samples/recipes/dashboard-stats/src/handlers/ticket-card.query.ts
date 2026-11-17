import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";
import { ticketExecutor } from "../schema/ticket";

export const ticketCardQuery = defineQueryHandler({
  name: "ticket:card",
  schema: z.object({ id: z.string() }),
  handler: async (query, ctx) => {
    const page = await ticketExecutor.list(
      { filter: { field: "id", op: "eq", value: query.payload.id }, limit: 1 },
      query.user,
      ctx.db,
    );
    const ticket = page.rows[0];
    return { id: query.payload.id, title: ticket?.title ?? "", status: ticket?.status ?? "" };
  },
  access: readerRoles,
});
