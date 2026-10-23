import { registerEntityCrud } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  registerEntityCrud(r, "order", orderEntity, {
    write: { access: { roles: ["ShopOwner"] } },
    read: { access: { roles: ["ShopOwner"] } },
  });
  registerEntityCrud(r, "invoice", invoiceEntity);
});
