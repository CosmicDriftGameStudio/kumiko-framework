import { createEntity } from "@cosmicdrift/kumiko-framework/engine";

export const orderEntity = createEntity({
  name: "order",
  fields: { total: { type: "number" } },
});
