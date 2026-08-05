// A minimal entity for the invoice's `product` reference cell — just
// enough to demonstrate a reference sub-field on an embedded list.

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";

export const productEntity = createEntity({
  table: "read_sample_products",
  fields: {
    name: createTextField({ required: true }),
  },
});

export const productTable = buildEntityTable("product", productEntity);
