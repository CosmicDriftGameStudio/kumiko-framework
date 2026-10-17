import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.writeHandler({ name: "order:cancel", schema, handler, access });
  r.queryHandler({ name: "order:list", schema, handler, access });
  r.entity({ name: "order", fields: {} });
  r.requires({ features: ["users"] });
  r.hook({ type: "postSave", target: order, handler: notify, phase: "afterCommit" });
  r.crud("invoice", invoiceEntity);
  r.entity(someEntityWithName);
});
