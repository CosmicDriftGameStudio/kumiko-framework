import { defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { productExecutor, productTable } from "../schema";

// -------------------------------------------------------------
// 2. inventory:product:rename — read + branch (skip-if-noop).
//    Demonstrates the read-then-conditional-write pattern.
//    The aggregate.update inside `onTrue` only runs when the
//    name actually changed — saves an event + a projection
//    write per redundant rename.
// -------------------------------------------------------------
export const productRenameWrite = defineWriteHandler({
  name: "product:rename",
  schema: z.object({ id: z.uuid(), name: z.string().min(1) }),
  access: { roles: ["Admin"] },
  perform: stepsPipeline<{ id: string; name: string }, { id: string; renamed: boolean }>(
    ({ event, r }) => [
      r.step.read.findOne("current", {
        table: productTable,
        where: () => ({ id: event.payload.id }),
      }),
      r.step.branch({
        if: ({ steps }) => {
          const cur = steps["current"] as { name: string } | null;
          return cur !== null && cur.name !== event.payload.name;
        },
        onTrue: [
          r.step.aggregate.update("product", {
            executor: productExecutor,
            id: () => event.payload.id,
            version: ({ steps }) => (steps["current"] as { version?: number } | null)?.version,
            changes: () => ({ name: event.payload.name }),
          }),
        ],
      }),
      r.step.return(({ steps }) => ({
        isSuccess: true as const,
        data: {
          id: event.payload.id,
          // Truthy iff the aggregate.update step actually ran —
          // the executor lands its SaveContext under steps.product.
          renamed: steps["product"] !== undefined,
        },
      })),
    ],
  ),
});
