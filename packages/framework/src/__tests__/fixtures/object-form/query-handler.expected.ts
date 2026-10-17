import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.queryHandler({ name: "order:list", schema: listSchema, handler: listOrders, access: { roles: ["ShopOwner"] },
    liveEntities: ["order"],
    outputSchema: orderListSchema });

  r.queryHandler({ name: "order:detail", schema: detailSchema, handler: detailOrder, ...readOptions });
});
