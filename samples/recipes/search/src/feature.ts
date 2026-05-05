// Search Sample
// Shows: searchable fields, searchWeight, search via InMemory SearchAdapter.
// Each handler builds its executor inline so `ctx.searchAdapter` is read fresh
// per call — tests swap the adapter between runs.

import { buildDrizzleTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const productEntity = createEntity({
  table: "read_sample_products",
  fields: {
    name: createTextField({ required: true, searchable: true }),
    brand: createTextField({ searchable: true }),
    sku: createTextField({ required: true }),
    category: createTextField(),
  },
  searchWeight: 10,
});

const productTable = buildDrizzleTable("product", productEntity);

export const productFeature = defineFeature("shop", (r) => {
  r.entity("product", productEntity);

  r.writeHandler(
    "product:create",
    z.object({
      name: z.string().min(1),
      brand: z.string().optional(),
      sku: z.string().min(1),
      category: z.string().optional(),
    }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(productTable, productEntity, {
        searchAdapter: ctx.searchAdapter,
        entityName: "product",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "product:list",
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    async (query, ctx) => {
      const crud = createEventStoreExecutor(productTable, productEntity, {
        searchAdapter: ctx.searchAdapter,
        entityName: "product",
      });
      return crud.list(query.payload, query.user, ctx.db);
    },
    { access: { openToAll: true } },
  );
});
