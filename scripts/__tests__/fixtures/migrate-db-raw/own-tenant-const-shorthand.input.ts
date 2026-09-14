import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { invoiceTable } from "./entities/invoice";

export const invoiceDetailQuery = defineQueryHandler({
  name: "invoice:detail",
  handler: async (query, ctx) => {
    const tenantId = query.user.tenantId;
    const row = await fetchOne<InvoiceRow>(ctx.db.raw, invoiceTable, { id: query.payload.id, tenantId });
    return row ?? null;
  },
});
