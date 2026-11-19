import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { orderEntity } from "./entity";

export const feature = defineFeature("orders", (r) => {
  r.entity({ name: "order", ...orderEntity });
});
