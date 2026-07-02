// Assigns an existing currency to a tenant (creates tenantCurrency entry)
// The currency must exist in the global currency table

import { assertExistsIn, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { currencyTable } from "../entities/currency";
import { tenantCurrencyEntity, tenantCurrencyTable } from "../entities/tenant-currency";

const tenantCurrencyCrud = createEventStoreExecutor(tenantCurrencyTable, tenantCurrencyEntity, {
  entityName: "tenant-currency",
});

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

    return tenantCurrencyCrud.create(
      {
        currencyCode: event.payload.currencyCode,
        isActive: event.payload.isActive ?? true,
      },
      event.user,
      ctx.db,
    );
  },
});
