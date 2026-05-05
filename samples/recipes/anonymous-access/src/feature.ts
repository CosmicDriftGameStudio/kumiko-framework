// Anonymous-Access Sample
//
// Most Kumiko apps put every endpoint behind a JWT — fine for CRMs, ERPs,
// and back-office tools where every caller is a known user. Shops, CMSs,
// marketing-microsites have a different shape: 50%+ of traffic is anonymous
// (visitors, scrapers, search engines) and the public surface is a feature,
// not a hack.
//
// This recipe wires that public surface in two ways:
//
//  1. `roles: ["anonymous"]` on a handler → unauthenticated callers reach it.
//     The framework synthesises a SessionUser with id="anonymous" + that
//     single role. `access.anonymous` is the typed shorthand for the role.
//
//  2. Combined with authenticated roles → the same handler serves both
//     audiences, with the handler-body branching on `event.user.id` if
//     personalisation is needed.
//
// `openToAll: true` is intentionally NOT public — it still means "any
// authenticated user", and the framework rejects anonymous callers there.
// Without that guard, enabling anonymousAccess on the server would silently
// expose every existing openToAll handler. The `product:authenticated-only`
// query below proves this.

import { buildDrizzleTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { access, createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const productEntity = createEntity({
  table: "shop_products",
  fields: {
    name: createTextField({ required: true }),
    priceCents: createTextField({ default: "0" }),
  },
});

export const guestOrderEntity = createEntity({
  table: "shop_guest_orders",
  fields: {
    productId: createTextField({ required: true }),
    email: createTextField({ required: true }),
    placedBy: createTextField({ default: "" }),
  },
});

export const productTable = buildDrizzleTable("product", productEntity);
export const guestOrderTable = buildDrizzleTable("guest-order", guestOrderEntity);

export const anonymousAccessFeature = defineFeature("shop", (r) => {
  r.entity("product", productEntity);
  r.entity("guest-order", guestOrderEntity);

  // Public listing: anonymous + authenticated customers see it. Combining
  // the roles in one handler is preferred over duplicating the read path —
  // the handler body can branch on `event.user.id === "anonymous"` if it
  // needs to personalise (e.g. show a sign-in CTA, hide a wishlist button).
  r.queryHandler(
    "product:list",
    z.object({}),
    async (_event, ctx) => ctx.db.select().from(productTable),
    { access: { roles: [...access.anonymous, "User", "Admin"] } },
  );

  // Authenticated-only listing — same data, different access rule. The
  // openToAll: true here is the regression-guard: even with anonymousAccess
  // enabled on the server, this endpoint stays gated to logged-in users.
  r.queryHandler(
    "product:authenticated-only",
    z.object({}),
    async (_event, ctx) => ctx.db.select().from(productTable),
    { access: { openToAll: true } },
  );

  // Anonymous + authenticated guest checkout. Stores the synthesised user-id
  // ("anonymous") in `placedBy` so audit-trail / support queries can tell
  // an authenticated order from a walk-in. Rate-limited per IP because every
  // anonymous caller shares user.id="anonymous" — a per-user rate-limit
  // would be a single global tap any caller could drain (the boot-validator
  // refuses the misconfiguration).
  const guestOrderExecutor = createEventStoreExecutor(guestOrderTable, guestOrderEntity, {
    entityName: "guest-order",
  });
  r.writeHandler(
    "guest-order:place",
    z.object({
      productId: z.uuid(),
      email: z.string().email(),
    }),
    async (event, ctx) =>
      guestOrderExecutor.create({ ...event.payload, placedBy: event.user.id }, event.user, ctx.db),
    {
      access: { roles: [...access.anonymous, "User"] },
      rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
    },
  );

  // Admin-only product CRUD — proves role-gated handlers still reject
  // anonymous callers. Same shape as any other handler in the framework:
  // anonymous is just a regular role, not a special case.
  r.writeHandler(
    "product:create",
    z.object({ name: z.string().min(1), priceCents: z.string() }),
    async (event, ctx) => {
      const exec = createEventStoreExecutor(productTable, productEntity, {
        entityName: "product",
      });
      return exec.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );
});
