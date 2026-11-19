import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type InvoiceState, initialInvoiceState, reduceInvoice } from "../schema";

// Persist a snapshot of the current state. In practice, features schedule
// this from a lifecycle hook (every N events, every M minutes) — here it's
// an explicit write-handler so the integration test can drive it.
export const invoiceTakeSnapshotWrite = defineWriteHandler({
  name: "invoice:take-snapshot",
  schema: z.object({ id: z.uuid() }),
  handler: async (event, ctx) => {
    // Rebuild the state from the current stream so the snapshot reflects
    // the committed event log, not an in-memory guess. Use the upcaster-
    // aware ctx.events.load to stay consistent with read-time semantics.
    const events = await ctx.events.load(event.payload.id);
    const state: InvoiceState = { ...initialInvoiceState };
    for (const evt of events) {
      reduceInvoice(state, evt);
    }
    const version = events.length > 0 ? (events[events.length - 1]?.version ?? 0) : 0;
    await ctx.events.snapshot({
      aggregateId: event.payload.id,
      aggregateType: "showcase-invoice",
      version,
      state: state as unknown as Record<string, unknown>,
    });
    return { isSuccess: true as const, data: { id: event.payload.id, snapshotVersion: version } };
  },
  access: { roles: ["Admin"] },
});
