import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { invoiceExecutor } from "../schema";

export const invoiceCreateWrite = defineWriteHandler({
  name: "invoice:create",
  schema: z.object({ customer: z.string() }),
  handler: async (event, ctx) =>
    invoiceExecutor.create(
      { customer: event.payload.customer, status: "draft" },
      event.user,
      ctx.db,
    ),
  access: { roles: ["Admin"] },
});
