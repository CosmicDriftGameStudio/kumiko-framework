import { invoiceTable } from "./entities/invoice";

export const invoiceListWrite = defineWriteHandler({
  name: "invoice:list",
  handler: async (event, ctx) => {
    const rows = await ctx.db.selectMany(invoiceTable, { tenantId: event.user.tenantId, status: "open" }, { limit: 20 });
    return rows;
  },
});
