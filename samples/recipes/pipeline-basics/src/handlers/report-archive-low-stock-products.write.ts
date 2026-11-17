import { defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { lowStockAlertsTable } from "../schema";

// -------------------------------------------------------------
// 6. inventory:report:bulk-archive-stale — forEach + read.findMany.
//    Demonstrates the read-list-then-loop pattern: pull a slice
//    of low-stock alerts via read.findMany, archive each. Used
//    by the integration test to prove findMany lands rows under
//    steps.<name> as an array.
// -------------------------------------------------------------
export function createReportArchiveLowStockProductsWrite(archivedEventName: string) {
  return defineWriteHandler({
    name: "report:archive-low-stock-products",
    schema: z.object({ reason: z.string().min(1) }),
    access: { roles: ["Admin"] },
    perform: stepsPipeline<{ reason: string }, { archivedCount: number }>(({ event, r }) => [
      r.step.read.findMany("alerts", {
        table: lowStockAlertsTable,
      }),
      r.step.forEach<{ productId: string }>({
        over: ({ steps }) => (steps["alerts"] as ReadonlyArray<{ productId: string }>) ?? [],
        as: "alert",
        do: [
          r.step.aggregate.appendEvent({
            aggregateId: ({ scope }) => (scope["alert"] as { productId: string }).productId,
            aggregateType: "product",
            type: archivedEventName,
            payload: () => ({ reason: event.payload.reason }),
            blindAppendReason:
              "archiving is decided by the low-stock alert row, not by the product state on the stream",
          }),
          r.step.unsafeProjectionDelete({
            table: lowStockAlertsTable,
            where: ({ scope }) => ({
              productId: (scope["alert"] as { productId: string }).productId,
            }),
          }),
        ],
      }),
      r.step.return(({ steps }) => ({
        isSuccess: true as const,
        data: {
          archivedCount: (steps["alerts"] as ReadonlyArray<unknown>).length,
        },
      })),
    ]),
  });
}
