// Search Sample
// Shows: searchable fields, searchWeight, search via InMemory SearchAdapter, a longText field
// with find: "fuzzy" (chunked in Meilisearch) and a trash list (onlyDeleted) for restore.
// Each handler builds its executor inline so `ctx.services.searchAdapter` is read fresh
// per call — tests swap the adapter between runs.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const productEntity = createEntity({
  table: "read_sample_products",
  fields: {
    name: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      searchable: true,
    }),
    brand: createTextField({ personal: false, reason: "is_business_data", searchable: true }),
    sku: createTextField({ personal: false, reason: "is_business_data", required: true }),
    category: createTextField({ personal: false, reason: "is_business_data" }),
  },
  searchWeight: 10,
});

// A long body is searched like any text field; softDelete gives the trash list and restore.
export const articleEntity = createEntity({
  table: "read_sample_articles",
  softDelete: true,
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    body: createLongTextField({ personal: "tenant", find: "fuzzy" }),
  },
});

const productTable = buildEntityTable("product", productEntity);

export const productFeature = defineFeature("shop", (r) => {
  r.entity({ name: "product", ...productEntity });
  r.entity({ name: "article", ...articleEntity });

  const articleAccess = { access: { roles: ["Admin"] } };
  for (const verb of ["create", "delete", "restore"] as const) {
    r.writeHandler(defineEntityWriteHandler(`article:${verb}`, articleEntity, articleAccess));
  }
  r.queryHandler(defineEntityQueryHandler("article:list", articleEntity, articleAccess));

  r.writeHandler({
    name: "product:create",
    schema: z.object({
      name: z.string().min(1),
      brand: z.string().optional(),
      sku: z.string().min(1),
      category: z.string().optional(),
    }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(productTable, productEntity, {
        searchAdapter: ctx.services.searchAdapter,
        entityName: "product",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "product:list",
    schema: z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    handler: async (query, ctx) => {
      const crud = createEventStoreExecutor(productTable, productEntity, {
        searchAdapter: ctx.services.searchAdapter,
        entityName: "product",
      });
      return crud.list(query.payload, query.user, ctx.db);
    },
    access: {
      openToAll: {
        reason:
          "any signed-in user may search and list products in this recipe; creating " +
          "a product still requires the Admin role above",
      },
    },
  });
});
