// Assigns an existing currency to a tenant (creates tenantCurrency entry)
// The currency must exist in the global currency table

import { assertExistsIn } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { currencyTable } from "../entities/currency";
import { tenantCurrencyTable } from "../entities/tenant-currency";

export const tenantCurrencyAssign = defineWriteHandler({
  name: "tenant-currency:assign",
  schema: z.object({
    currencyCode: z.string().length(3),
    isActive: z.boolean().optional(),
  }),
  access: { roles: ["Admin"] },
  handler: async (event, ctx) => {
    // Validate that the currency exists in the global reference table (no tenantId — global data)
    const notFound = await assertExistsIn(ctx.db, currencyTable, {
      field: "code",
      value: event.payload.currencyCode,
      entityName: "currency",
    });
    if (notFound) return writeFailure(notFound);

    const [row] = await ctx.db
      .insert(tenantCurrencyTable)
      .values({
        currencyCode: event.payload.currencyCode,
        isActive: event.payload.isActive ?? true,
        insertedById: event.user.id,
        insertedAt: Temporal.Now.instant(),
      })
      .returning();
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
