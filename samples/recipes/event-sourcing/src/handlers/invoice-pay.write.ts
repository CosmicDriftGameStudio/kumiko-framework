import { defineWriteHandler, type EventDef, emitEvent } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export function createInvoicePayWrite(paid: EventDef<{ amountCents: number }>) {
  return defineWriteHandler({
    name: "invoice:pay",
    schema: z.object({ id: z.uuid(), amountCents: z.number().int() }),
    handler: async (event, ctx) => {
      await emitEvent(ctx, paid, {
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        payload: { amountCents: event.payload.amountCents },
        blindAppendReason:
          "a payment is a fact about the invoice; the handler reads no invoice state to decide it",
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    access: { roles: ["Admin"] },
    // Per-user cap: a single admin shouldn't fire more than 5 pay
    // operations per minute. Real production caps would be per
    // tenant + handler ("tenant+handler") to keep one admin from
    // monopolising the tenant's quota — kept simple here for the
    // sample. Demonstrates the fourth dispatcher gate (rate-limit
    // → access → validation → handler).
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });
}
