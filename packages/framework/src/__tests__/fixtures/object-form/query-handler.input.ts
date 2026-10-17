import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.queryHandler("order:list", listSchema, listOrders, {
    access: { roles: ["ShopOwner"] },
    liveEntities: ["order"],
    outputSchema: orderListSchema,
  });

  r.queryHandler("order:detail", detailSchema, detailOrder, readOptions);
});
