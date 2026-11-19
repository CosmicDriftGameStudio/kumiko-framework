// Initial create — uses createEventStoreExecutor.create so the executor
// generates the UUID, writes the auto "invoice.created" event onto the
// stream, and inserts the projection row with status="draft" (entity-default).
//
// Schema is hand-written (not buildInsertSchema) because the public API
// keeps amount + amountCurrency flat; the handler wraps them into the
// { amount, currency } money pair (amount in minor units) the executor takes.

import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { invoiceEntity, invoiceTable } from "../entities/invoice";

const invoiceExecutor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
  entityName: "invoice",
});

export const invoiceCreate = defineWriteHandler({
  name: "invoice:create",
  schema: z.object({
    title: z.string().min(1),
    amount: z.number().int(),
    amountCurrency: z.string().length(3),
  }),
  access: { roles: ["Admin"] },
  handler: async (event, ctx) => {
    const { title, amount, amountCurrency } = event.payload;
    return invoiceExecutor.create(
      { title, amount: { amount, currency: amountCurrency } },
      event.user,
      ctx.db,
    );
  },
});
