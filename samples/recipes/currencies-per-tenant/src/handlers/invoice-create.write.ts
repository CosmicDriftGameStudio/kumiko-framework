import { assertExistsIn, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { currencyTable } from "../entities/currency";
import { invoiceEntity, invoiceTable } from "../entities/invoice";

const invoiceCrud = createEventStoreExecutor(invoiceTable, invoiceEntity, {
  entityName: "invoice",
});

export const invoiceCreate = defineWriteHandler({
  name: "invoice:create",
  schema: z.object({
    title: z.string().min(1),
    amount: z.number(),
    amountCurrency: z.string().length(3),
    shippingCost: z.number().optional(),
    shippingCostCurrency: z.string().length(3).optional(),
  }),
  access: { roles: ["Admin"] },
  handler: async (event, ctx) => {
    const { title, amount, amountCurrency, shippingCost, shippingCostCurrency } = event.payload;

    // Validate currency against tenant's own currency list
    const amountMissing = await assertExistsIn(ctx.db, currencyTable, {
      field: "code",
      value: amountCurrency,
      where: { isActive: true },
    });
    if (amountMissing) {
      return failUnprocessable("currency_not_allowed", {
        field: "amountCurrency",
        value: amountCurrency,
      });
    }

    if (shippingCostCurrency) {
      const shippingMissing = await assertExistsIn(ctx.db, currencyTable, {
        field: "code",
        value: shippingCostCurrency,
        where: { isActive: true },
      });
      if (shippingMissing) {
        return failUnprocessable("currency_not_allowed", {
          field: "shippingCostCurrency",
          value: shippingCostCurrency,
        });
      }
    }

    // Money fields go in as the combined { amount, currency } API form; the
    // executor flattens them into the invoice's own amount/amountCurrency columns.
    return invoiceCrud.create(
      {
        title,
        amount: { amount, currency: amountCurrency },
        ...(shippingCost !== undefined
          ? { shippingCost: { amount: shippingCost, currency: shippingCostCurrency } }
          : {}),
      },
      event.user,
      ctx.db,
    );
  },
});
