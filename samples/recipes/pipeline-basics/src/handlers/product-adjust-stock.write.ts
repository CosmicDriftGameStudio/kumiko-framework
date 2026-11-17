import {
  defineWriteHandler,
  type PipelineCtx,
  stepsPipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { LOW_STOCK_THRESHOLD, lowStockAlertsTable, productTable } from "../schema";

// -------------------------------------------------------------
// 3. inventory:product:adjust-stock — every Tier-1 step in one
//    handler. Production-realistic: read aggregate, compute new
//    stock, persist update, append a domain-event for the
//    audit-trail, then upsert OR delete the low-stock-alert
//    based on whether the new stock crosses the threshold.
// -------------------------------------------------------------
export function createProductAdjustStockWrite(stockAdjustedEventName: string) {
  return defineWriteHandler({
    name: "product:adjust-stock",
    schema: z.object({
      id: z.uuid(),
      delta: z.number().int(),
      reason: z.string().min(1),
    }),
    access: { roles: ["Admin", "User"] },
    perform: stepsPipeline<
      { id: string; delta: number; reason: string },
      { id: string; newStock: number }
    >(({ event, r }) => [
      // Read before the row: newStock below is decided on this read, so the append is pinned to it.
      r.step.compute("streamVersion", ({ events }) => events.streamVersion(event.payload.id)),
      r.step.read.findOne("current", {
        table: productTable,
        where: () => ({ id: event.payload.id }),
      }),
      r.step.compute("newStock", ({ steps }) => {
        const cur = steps["current"] as { currentStock: number } | null;
        if (!cur) {
          throw new Error(`product not found: ${event.payload.id}`);
        }
        return cur.currentStock + event.payload.delta;
      }),
      // Pure-ES: emit the domain event; the inline `product-stock-counter`
      // projection in feature.ts replays it onto the product row in the same TX.
      // No aggregate.update here — see the projection's comment for why
      // the split is intentional.
      r.step.aggregate.appendEvent({
        aggregateId: () => event.payload.id,
        aggregateType: "product",
        type: stockAdjustedEventName,
        expectedVersion: ({ steps }: PipelineCtx) => steps["streamVersion"] as number,
        // Explicit ctx-type: payload's resolver is StepResolver<unknown>,
        // which prevents TS from inferring `ctx.steps` shape via the
        // destructure. Followup #4 (TData-Inference) tracks the DX-fix.
        payload: ({ steps }: PipelineCtx) => ({
          delta: event.payload.delta,
          reason: event.payload.reason,
          newStock: steps["newStock"] as number,
        }),
      }),
      // Inline projection-maintenance: cross the threshold in
      // either direction in the same TX as the aggregate write.
      // Async multi-stream projections would lag here — this is
      // the use-case for inline unsafeProjection.*.
      r.step.branch({
        if: ({ steps }) => (steps["newStock"] as number) < LOW_STOCK_THRESHOLD,
        onTrue: [
          r.step.unsafeProjectionUpsert({
            table: lowStockAlertsTable,
            on: ["productId"],
            row: ({ steps }) => {
              const cur = steps["current"] as { sku: string };
              return {
                productId: event.payload.id,
                sku: cur.sku,
                currentStock: steps["newStock"] as number,
                threshold: LOW_STOCK_THRESHOLD,
              };
            },
          }),
        ],
        onFalse: [
          r.step.unsafeProjectionDelete({
            table: lowStockAlertsTable,
            where: () => ({ productId: event.payload.id }),
          }),
        ],
      }),
      r.step.return(({ steps }) => ({
        isSuccess: true as const,
        data: {
          id: event.payload.id,
          newStock: steps["newStock"] as number,
        },
      })),
    ]),
  });
}
