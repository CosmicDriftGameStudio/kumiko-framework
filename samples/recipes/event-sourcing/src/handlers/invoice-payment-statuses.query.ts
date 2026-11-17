import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// List page over many invoices: ONE query for just the approved/paid events of the
// requested aggregates instead of ctx.events.load per invoice.
export function createInvoicePaymentStatusesQuery(eventNames: {
  readonly approved: string;
  readonly paid: string;
}) {
  return defineQueryHandler({
    name: "invoice:payment-statuses",
    schema: z.object({ ids: z.array(z.uuid()).max(200) }),
    handler: async (query, ctx) => {
      const events = await ctx.events.loadByTypes({
        aggregateIds: query.payload.ids,
        eventTypes: [eventNames.approved, eventNames.paid],
      });
      const lastEventByInvoice = new Map<string, string>();
      for (const evt of events) {
        lastEventByInvoice.set(evt.aggregateId, evt.type);
      }
      return {
        statuses: [...lastEventByInvoice].map(([id, lastEventType]) => ({
          id,
          status: lastEventType === eventNames.paid ? "paid" : "approved",
        })),
      };
    },
    access: {
      openToAll: {
        reason:
          "demo recipe: any signed-in user may read invoice payment statuses; " +
          "there is no per-user invoice ownership in this sample",
      },
    },
  });
}
