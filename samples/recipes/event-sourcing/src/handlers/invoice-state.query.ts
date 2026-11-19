import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type InvoiceState, initialInvoiceState, reduceInvoice } from "../schema";

// Live aggregation via ctx.events.load — reduces events into a state
// snapshot. Supports asOf for point-in-time reads.
export const invoiceStateQuery = defineQueryHandler({
  name: "invoice:state",
  schema: z.object({ id: z.uuid(), asOf: z.iso.datetime().optional() }),
  handler: async (query, ctx) => {
    const events = await ctx.events.load(query.payload.id, {
      ...(query.payload.asOf ? { asOf: Temporal.Instant.from(query.payload.asOf) } : {}),
    });
    const state: InvoiceState = { ...initialInvoiceState };
    for (const evt of events) {
      reduceInvoice(state, evt);
    }
    return state;
  },
  access: {
    openToAll: {
      reason:
        "demo recipe: any signed-in user may read the event-sourced invoice state; " +
        "there is no per-user invoice ownership in this sample",
    },
  },
});
