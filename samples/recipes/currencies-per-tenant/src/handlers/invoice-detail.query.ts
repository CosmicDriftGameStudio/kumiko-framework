import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { invoiceTable } from "../entities/invoice";

export const invoiceDetail = defineQueryHandler({
  name: "invoice:detail",
  schema: z.object({ id: z.uuid() }),
  access: {
    openToAll: {
      reason:
        "demo recipe: any signed-in user may look up any invoice in their own tenant " +
        "by id; the sample focuses on currency formatting, not access control",
    },
  },
  handler: async (query, ctx) => {
    const [row] = await ctx.db.selectMany(invoiceTable, { id: query.payload.id });
    return (row as Record<string, unknown>) ?? null;
  },
});
