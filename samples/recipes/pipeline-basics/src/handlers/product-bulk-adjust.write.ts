import { defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { productExecutor, productTable } from "../schema";

// -------------------------------------------------------------
// 4. inventory:product:bulk-adjust — forEach over a list of
//    adjustments. Each iteration is its own read+update mini-
//    pipeline; `scope.adj` is the per-iteration item.
//    Sequential by design (concurrency=1 in M.1.6).
// -------------------------------------------------------------
export const productBulkAdjustWrite = defineWriteHandler({
  name: "product:bulk-adjust",
  schema: z.object({
    adjustments: z.array(z.object({ id: z.uuid(), delta: z.number().int() })).min(1),
  }),
  access: { roles: ["Admin"] },
  perform: stepsPipeline<
    { adjustments: ReadonlyArray<{ id: string; delta: number }> },
    { processed: number }
  >(({ event, r }) => [
    r.step.forEach({
      over: () => event.payload.adjustments,
      as: "adj",
      do: [
        r.step.read.findOne("current", {
          table: productTable,
          where: ({ scope }) => ({ id: (scope["adj"] as { id: string }).id }),
        }),
        r.step.compute("newStock", ({ steps, scope }) => {
          const cur = steps["current"] as { currentStock: number } | null;
          const adj = scope["adj"] as { delta: number };
          if (!cur) throw new Error("product not found in bulk-adjust");
          return cur.currentStock + adj.delta;
        }),
        r.step.aggregate.update("product", {
          executor: productExecutor,
          id: ({ scope }) => (scope["adj"] as { id: string }).id,
          version: ({ steps }) => (steps["current"] as { version?: number } | null)?.version,
          changes: ({ steps }) => ({ currentStock: steps["newStock"] as number }),
          // Pure update path inside forEach — no appendEvent
          // alongside, so optimistic-locking stays meaningful.
        }),
      ],
    }),
    r.step.return(() => ({
      isSuccess: true as const,
      data: { processed: event.payload.adjustments.length },
    })),
  ]),
});
