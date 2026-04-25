import { defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { invoiceTable } from "../entities/invoice";

export const invoiceDetail = defineQueryHandler({
  name: "invoice:detail",
  schema: z.object({ id: z.uuid() }),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const [row] = await ctx.db
      .select()
      .from(invoiceTable)
      .where(eq(invoiceTable["id"], query.payload.id));
    return (row as Record<string, unknown>) ?? null;
  },
});
