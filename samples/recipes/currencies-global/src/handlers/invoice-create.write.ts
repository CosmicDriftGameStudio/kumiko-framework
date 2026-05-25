import { assertExistsIn } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { invoiceTable } from "../entities/invoice";
import { tenantCurrencyTable } from "../entities/tenant-currency";

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

    // Validate amount currency against tenant's allowed currencies. This is a
    // business-rule violation (currency not permitted here), not a missing
    // entity, so 422 + reason="currency_not_allowed" is the right shape.
    const amountMissing = await assertExistsIn(ctx.db, tenantCurrencyTable, {
      field: "currencyCode",
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
      const shippingMissing = await assertExistsIn(ctx.db, tenantCurrencyTable, {
        field: "currencyCode",
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
