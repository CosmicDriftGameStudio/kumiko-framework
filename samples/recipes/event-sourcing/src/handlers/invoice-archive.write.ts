import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const invoiceArchiveWrite = defineWriteHandler({
  name: "invoice:archive",
  schema: z.object({ id: z.uuid() }),
  handler: async (event, ctx) => {
    await ctx.events.archive(event.payload.id, { aggregateType: "showcase-invoice" });
    return { isSuccess: true as const, data: { id: event.payload.id } };
  },
  access: { roles: ["Admin"] },
});
