import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// Existence and version probe without loading the stream; counts archived streams too.
export const invoiceStreamVersionQuery = defineQueryHandler({
  name: "invoice:stream-version",
  schema: z.object({ id: z.uuid() }),
  handler: async (query, ctx) => ({ version: await ctx.events.streamVersion(query.payload.id) }),
  access: {
    openToAll: {
      reason:
        "demo recipe: any signed-in user may read the event-sourced invoice state; " +
        "there is no per-user invoice ownership in this sample",
    },
  },
});
