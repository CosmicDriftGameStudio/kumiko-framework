import { defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { lowStockAlertsTable } from "../schema";

// -------------------------------------------------------------
// 5. inventory:product:archive — domain-event + projection
//    cleanup. The aggregate is preserved (event-sourced!), the
//    side-projection row gets purged in the same TX. Reads
//    against archived products still work via loadAggregate;
//    list-views skip them by filtering on the archived event.
// -------------------------------------------------------------
export function createProductArchiveWrite(archivedEventName: string) {
  return defineWriteHandler({
    name: "product:archive",
    schema: z.object({ id: z.uuid(), reason: z.string().min(1) }),
    access: { roles: ["Admin"] },
    perform: stepsPipeline<{ id: string; reason: string }, { id: string }>(({ event, r }) => [
      r.step.aggregate.appendEvent({
        aggregateId: () => event.payload.id,
        aggregateType: "product",
        type: archivedEventName,
        payload: () => ({ reason: event.payload.reason }),
      }),
      r.step.unsafeProjectionDelete({
        table: lowStockAlertsTable,
        where: () => ({ productId: event.payload.id }),
      }),
      r.step.return(() => ({
        isSuccess: true as const,
        data: { id: event.payload.id },
      })),
    ]),
  });
}
