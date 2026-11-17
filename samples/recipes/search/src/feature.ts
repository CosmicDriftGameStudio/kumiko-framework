// Search Sample
// Shows: searchable fields, searchWeight, search via InMemory SearchAdapter, a longText field
// with find: "fuzzy" (chunked in Meilisearch) and a trash list (onlyDeleted) for restore.
// Each handler builds its executor inline so `ctx.services.searchAdapter` is read fresh
// per call — tests swap the adapter between runs.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createReferenceField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityRestoreHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const productEntity = createEntity({
  name: "product",
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
  name: "article",
  table: "read_sample_articles",
  softDelete: true,
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    body: createLongTextField({ personal: "tenant", find: "fuzzy" }),
  },
});

// A searchable hasMany relation lets a list search on the article also find it through its comments.
export const commentEntity = createEntity({
  name: "comment",
  table: "read_sample_article_comments",
  fields: {
    articleId: createReferenceField({
      entity: "article",
      personal: false,
      reason: "is_system_identifier",
      required: true,
    }),
    text: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      searchable: true,
    }),
  },
});

const productTable = buildEntityTable(productEntity);

export const productFeature = defineFeature("shop", (r) => {
  r.entity(productEntity);
  const article = r.entity(articleEntity);
  r.entity(commentEntity);
  r.relation({ entity: article, name: "comments", type: "hasMany",
    target: "comment",
    foreignKey: "articleId",
    searchable: true });

  const articleAccess = { access: { roles: ["Admin"] } };
  r.writeHandler(defineEntityCreateHandler("article", articleEntity, articleAccess));
  r.writeHandler(defineEntityDeleteHandler("article", articleEntity, articleAccess));
  r.writeHandler(defineEntityRestoreHandler("article", articleEntity, articleAccess));
  r.queryHandler(defineEntityListHandler("article", articleEntity, articleAccess));
  r.writeHandler(defineEntityCreateHandler("comment", commentEntity, articleAccess));
  r.queryHandler(defineEntityDetailHandler("comment", commentEntity, articleAccess));

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
