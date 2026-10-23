import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { invoiceTable } from "./entities/invoice";

export const invoiceListWrite = defineWriteHandler({
  name: "invoice:list",
  handler: async (event, ctx) => {
    const rows = await selectMany(
      ctx.db.raw,
      invoiceTable,
      { tenantId: event.user.tenantId, status: "open" },
      { limit: 20 },
    );
    return rows;
  },
});
