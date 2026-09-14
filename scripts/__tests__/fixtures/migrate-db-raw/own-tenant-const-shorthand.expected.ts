import { invoiceTable } from "./entities/invoice";

export const invoiceDetailQuery = defineQueryHandler({
  name: "invoice:detail",
  handler: async (query, ctx) => {
    const tenantId = query.user.tenantId;
    const row = await ctx.db.fetchOne<InvoiceRow>(invoiceTable, { id: query.payload.id, tenantId });
    return row ?? null;
  },
});
