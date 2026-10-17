import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.writeHandler("order:cancel", cancelSchema, cancelOrder, {
    // only the shop owner may cancel
    access: { openToAll: { reason: "codemod fixture" } },
    description: "Cancel an order",
  });

  r.writeHandler("order:ship", shipSchema, shipOrder, shipOptions);

  r.writeHandler<typeof refundSchema>("order:refund", refundSchema, async (event, ctx) => {
    return { isSuccess: true, data: {} };
  }, { access: { openToAll: { reason: "codemod fixture" } }, escapeHatch: { reason: "refunds cross tenants" } });

  r.writeHandler(
    /* wire name */ "order:archive",
    schema,
    handler,
    { access },
  );
});
