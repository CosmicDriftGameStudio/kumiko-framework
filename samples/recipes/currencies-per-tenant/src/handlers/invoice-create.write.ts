import { assertExistsIn } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { currencyTable } from "../entities/currency";
import { invoiceTable } from "../entities/invoice";

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

    const row = await ctx.db.insertOne(invoiceTable, {
      title,
      amount,
      amountCurrency,
      shippingCost: shippingCost ?? null,
      ...(shippingCostCurrency !== undefined && { shippingCostCurrency }),
      insertedById: event.user.id,
      insertedAt: Temporal.Now.instant(),
    });

    const data = row as Record<string, unknown>;
    return {
      isSuccess: true,
      data: {
        id: data["id"] as number,
        data,
        changes: event.payload,
        previous: {},
        isNew: true,
      },
    };
  },
});
