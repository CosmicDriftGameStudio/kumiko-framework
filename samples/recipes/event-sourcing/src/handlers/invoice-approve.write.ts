import { defineWriteHandler, type EventDef, emitEvent } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export function createInvoiceApproveWrite(
  approved: EventDef<{ amountCents: number; approvedBy: string }>,
) {
  return defineWriteHandler({
    name: "invoice:approve",
    schema: z.object({
      id: z.uuid(),
      amountCents: z.number().int(),
      approvedBy: z.string(),
      // Optional ops metadata that the caller wants threaded into the
      // event for later filtering/auditing without bloating the payload.
      geoRegion: z.string().optional(),
      abTestBucket: z.string().optional(),
    }),
    handler: async (event, ctx) => {
      const headers: Record<string, string> = {};
      if (event.payload.geoRegion) headers["geoRegion"] = event.payload.geoRegion;
      if (event.payload.abTestBucket) headers["abTestBucket"] = event.payload.abTestBucket;
      await emitEvent(ctx, approved, {
        aggregateId: event.payload.id,
        aggregateType: "showcase-invoice",
        payload: { amountCents: event.payload.amountCents, approvedBy: event.payload.approvedBy },
        blindAppendReason:
          "an approval is a fact about the invoice; the handler reads no invoice state to decide it",
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    access: { roles: ["Admin"] },
  });
}
