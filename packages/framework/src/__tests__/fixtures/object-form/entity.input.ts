import { createEntity } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.entity("order", orderEntity);

  r.entity("invoice", {
    fields: { total: createMoneyField({ required: true }) },
    table: "invoices",
  });

  r.entity("customer", createEntity({ fields: { name: createTextField({ personal: false, reason: "test_fixture" }) } }));

  r.entity("legacy", legacyEntity, { table: legacyTable });

  r.entity("shorthand", shorthandEntity, { table });

  const ref = r.entity("ref", refEntity);
});
