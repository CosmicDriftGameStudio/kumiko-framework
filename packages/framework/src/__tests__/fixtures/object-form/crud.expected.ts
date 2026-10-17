import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.crud("order", orderEntity, {
    write: { access: { roles: ["ShopOwner"] } },
    read: { access: { roles: ["ShopOwner"] } },
  });
  r.crud("invoice", invoiceEntity);
});
