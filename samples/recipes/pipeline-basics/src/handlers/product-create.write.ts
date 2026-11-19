import { defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { productExecutor } from "../schema";

// -------------------------------------------------------------
// 1. inventory:product:create — straight aggregate.create.
//    Simplest pipeline form: one mutating step + return.
// -------------------------------------------------------------
export const productCreateWrite = defineWriteHandler({
  name: "product:create",
  schema: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    initialStock: z.number().int().min(0).default(0),
  }),
  access: { roles: ["Admin"] },
  perform: stepsPipeline<{ sku: string; name: string; initialStock: number }, { id: string }>(
    ({ event, r }) => [
      r.step.aggregate.create("product", {
        executor: productExecutor,
        data: () => ({
          sku: event.payload.sku,
          name: event.payload.name,
          currentStock: event.payload.initialStock,
        }),
      }),
      r.step.return(({ steps }) => ({
        isSuccess: true as const,
        data: { id: (steps["product"] as { id: string }).id },
      })),
    ],
  ),
});
