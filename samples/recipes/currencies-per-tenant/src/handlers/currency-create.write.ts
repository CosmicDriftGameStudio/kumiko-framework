// Tenant creates their own currency — no global table needed

import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { currencyEntity, currencyTable } from "../entities/currency";

const currencyCrud = createEventStoreExecutor(currencyTable, currencyEntity, {
  entityName: "currency",
});

export const currencyCreate = defineWriteHandler({
  name: "currency:create",
  schema: z.object({
    code: z.string().length(3),
    name: z.string().min(1),
    isActive: z.boolean().optional(),
  }),
  access: { roles: ["Admin"] },
  // Event-sourced create — the executor appends `currency.created` + applies the
  // projection in one TX (id + audit columns are set for us). A direct insertOne
  // would drift the row past its event stream and a rebuild would wipe it.
  handler: async (event, ctx) => currencyCrud.create(event.payload, event.user, ctx.db),
});
