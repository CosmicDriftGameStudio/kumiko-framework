import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { invoiceTable } from "../entities/invoice";

export const invoiceDetail = defineQueryHandler({
  name: "invoice:detail",
  schema: z.object({ id: z.uuid() }),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const [row] = await ctx.db.selectMany(invoiceTable, { id: query.payload.id });
    return (row as Record<string, unknown>) ?? null;
  },
});
