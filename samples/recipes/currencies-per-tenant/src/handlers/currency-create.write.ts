// Tenant creates their own currency — no global table needed

import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { currencyTable } from "../entities/currency";

export const currencyCreate = defineWriteHandler({
  name: "currency:create",
  schema: z.object({
    code: z.string().length(3),
    name: z.string().min(1),
    isActive: z.boolean().optional(),
  }),
  access: { roles: ["Admin"] },
  handler: async (event, ctx) => {
    const [row] = await ctx.db.insertOne(currencyTable, {
        ...event.payload,
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
