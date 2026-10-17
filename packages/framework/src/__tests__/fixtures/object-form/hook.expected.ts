import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  const order = r.entity({ name: "order", ...orderEntity });

  r.hook({ type: "validation", target: order, handler: validateOrder });
  r.hook({ type: "preSave", target: order, handler: stampOrder, escapeHatch: { reason: "stamps across tenants" } });
  r.hook({ type: "postSave", target: { allOf: order }, handler: notifyShop, phase: "afterCommit" });
  r.hook({ type: "preDelete", target: [order, invoice], handler: guardDelete });
  r.hook({ type: "postDelete", target: { allOf: order }, handler: cleanUp, phase: "inTransaction",
    escapeHatch: { reason: "cleans foreign rows" } });
  r.hook({ type: "preQuery", target: order, handler: scopeQuery });
  r.hook({ type: "postQuery", target: { allOf: order }, handler: mergeCustomFields });
});
