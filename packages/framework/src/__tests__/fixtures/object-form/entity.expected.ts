import { createEntity } from "@cosmicdrift/kumiko-framework/engine";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("orders", (r) => {
  r.entity({ name: "order", ...orderEntity });

  r.entity({ name: "invoice", fields: { total: createMoneyField({ required: true }) },
    table: "invoices" });

  r.entity({ name: "customer", ...createEntity({ fields: { name: createTextField({ personal: false, reason: "test_fixture" }) } }) });

  r.entity({ name: "legacy", ...legacyEntity, backingTable: legacyTable });

  r.entity({ name: "shorthand", ...shorthandEntity, backingTable: table });

  const ref = r.entity({ name: "ref", ...refEntity });
});
