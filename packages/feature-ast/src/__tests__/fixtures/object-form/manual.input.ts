import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { registerEntityCrud } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.writeHandler("order:cancel", cancelSchema);
  r.writeHandler(...handlerArgs);
  r.queryHandler("q", ...queryArgs);
  r.entity("order", orderEntity, { table: orderTable, extra: true });
  r.entity("order2", orderEntity, options);
  r.hook("postSave", order, ...hookArgs);
  r.requires({ features: ["a"] }, "b");
  registerEntityCrud(methods, "order", orderEntity);
  registerEntityCrud(r, "order");
});

function unresolved() {
  const r = createRegistrar();
  r.writeHandler("order:cancel", cancelSchema, cancelOrder, { access });
  r.requires("users");
  const used = registerEntityCrud;
}
