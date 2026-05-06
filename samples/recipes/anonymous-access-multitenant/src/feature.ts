// Multi-Tenant Anonymous Access — Subdomain-Resolver Pattern
//
// Use case: SaaS deployment where every customer gets `<tenant>.shop.com`.
// Anonymous visitors land on the right tenant via the host header. The
// recipe shows the three pieces an app needs:
//
//  1. tenantResolver — parses the Host header, looks up the tenantId in
//     a small cache + DB. Returns null on misses (404 to the visitor).
//  2. tenantExists   — guards header/cookie-supplied ids the same cache.
//  3. setTenantCookie — once the resolver decided, persist on the visitor
//     so subsequent requests skip the parse + DB lookup.
//
// The product/order entities are minimal — the focus of this recipe is
// the resolution chain, not the domain logic. Pair this with the
// single-tenant recipe (samples/recipes/anonymous-access/) for
// comparison.

import { buildDrizzleTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const productEntity = createEntity({
  table: "mt_products",
  fields: {
    name: createTextField({ required: true }),
  },
});

export const productTable = buildDrizzleTable("product", productEntity);

export const multiTenantShopFeature = defineFeature("mtshop", (r) => {
  r.entity("product", productEntity);

  // Public listing — every tenant has its own products, scoped by tenantId
  // automatically via the framework's tenant-isolation. Anonymous visitors
  // see only the tenant they landed on.
  r.queryHandler(
    "product:list",
    z.object({}),
    async (_event, ctx) => ctx.db.select().from(productTable),
    { access: { roles: [...access.anonymous, "User", "Admin"] } },
  );

  // Admin-only — proves role-gating still works on top of the multi-tenant
  // anonymous resolution.
  r.writeHandler(
    "product:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) => {
      const exec = createEventStoreExecutor(productTable, productEntity, {
        entityName: "product",
      });
      return exec.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );
});
