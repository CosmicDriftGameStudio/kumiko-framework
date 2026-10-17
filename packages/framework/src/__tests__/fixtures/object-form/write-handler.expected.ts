import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.writeHandler({ name: "order:cancel", schema: cancelSchema, handler: cancelOrder, // only the shop owner may cancel
    access: { openToAll: { reason: "codemod fixture" } },
    description: "Cancel an order" });

  r.writeHandler({ name: "order:ship", schema: shipSchema, handler: shipOrder, ...shipOptions });

  r.writeHandler({ name: "order:refund", schema: refundSchema, handler: async (event, ctx) => {
    return { isSuccess: true, data: {} };
  }, access: { openToAll: { reason: "codemod fixture" } }, escapeHatch: { reason: "refunds cross tenants" } });

  r.writeHandler({ name: /* wire name */ "order:archive", schema, handler, access });
});
