import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  const order = r.entity("order", orderEntity);

  r.hook("validation", order, validateOrder);
  r.hook("preSave", order, stampOrder, { escapeHatch: { reason: "stamps across tenants" } });
  r.hook("postSave", { allOf: order }, notifyShop, { phase: "afterCommit" });
  r.hook("preDelete", [order, invoice], guardDelete);
  r.hook("postDelete", { allOf: order }, cleanUp, {
    phase: "inTransaction",
    escapeHatch: { reason: "cleans foreign rows" },
  });
  r.hook("preQuery", order, scopeQuery);
  r.hook("postQuery", { allOf: order }, mergeCustomFields);
});
