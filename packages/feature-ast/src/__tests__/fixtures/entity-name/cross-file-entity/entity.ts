import { createEntity } from "@cosmicdrift/kumiko-framework/engine";

export const orderEntity = createEntity({
  fields: { total: { type: "number" } },
});
