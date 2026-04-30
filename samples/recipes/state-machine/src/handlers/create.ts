// Initial create — uses createEventStoreExecutor.create so the executor
// generates the UUID, writes the auto "invoice.created" event onto the
// stream, and inserts the projection row with status="draft" (entity-default).
//
// Schema is hand-written (not buildInsertSchema) because the public API
// keeps amount + amountCurrency flat, while the entity stores them as a
// money pair.

import { createEventStoreExecutor } from "@kumiko/framework/db";
import { z } from "zod";
import { defineWriteHandler } from "../../.kumiko/define";
import { invoiceEntity, invoiceTable } from "../entities/invoice";

const invoiceExecutor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
  entityName: "invoice",
});

export const invoiceCreate = defineWriteHandler({
  name: "invoice:create",
  schema: z.object({
    title: z.string().min(1),
    amount: z.number(),
    amountCurrency: z.string().length(3),
  }),
  access: { roles: ["Admin"] },
  handler: async (event, ctx) => invoiceExecutor.create(event.payload, event.user, ctx.db),
});
