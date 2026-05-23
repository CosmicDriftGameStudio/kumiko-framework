// Feature-Toggles Showcase — two toggleable features that prove the two
// operator-visible gate points in one test:
//
//   1. Dispatcher-gate on the owner feature's handler (403 feature_disabled)
//   2. Hook-filter on a cross-feature r.entityHook (skipped when hook-owner off)
//
// The feature-toggles bundled-feature itself is loaded in the integration
// test so the canonical wiring (runtime accessor + effectiveFeatures
// callback + set-handler) is exercised as documentation, not just in the
// framework's own tests.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
  type FeatureDefinition,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

// product — toggleable, default on. Owns the `product` entity and a
// create-handler. Wire-path: event-store executor → projection table →
// lifecycle pipeline (that's where the cross-feature hook below gets
// invoked from).
export const productEntity = createEntity({
  table: "read_products",
  fields: {
    name: createTextField({ required: true, maxLength: 100 }),
    active: createBooleanField({ default: true }),
  },
});
export const productTable = buildEntityTable("product", productEntity);
const productCrud = createEventStoreExecutor(productTable, productEntity, {
  entityName: "product",
});

export function createProductFeature(): FeatureDefinition {
  return defineFeature("product", (r) => {
    r.systemScope();
    r.toggleable({ default: true });
    r.entity("product", productEntity);
    r.writeHandler(
      "product:create",
      z.object({ name: z.string().min(1).max(100) }),
      async (event, ctx) => productCrud.create(event.payload, event.user, ctx.db),
      { access: { roles: ["SystemAdmin"] } },
    );
  });
}

// product-audit — toggleable, default on. Registers a cross-feature
// r.entityHook on product's postSave. When this feature is globally off,
// the hook is silently skipped; product's own write-handler keeps working.
// When product itself is off, the handler is gated before any write
// happens — the hook never has anything to react to.
export const productAuditEntity = createEntity({
  table: "read_product_audits",
  fields: {
    productName: createTextField({ required: true, maxLength: 100 }),
  },
});
export const productAuditTable = buildEntityTable("product-audit", productAuditEntity);

export function createProductAuditFeature(): FeatureDefinition {
  return defineFeature("product-audit", (r) => {
    r.systemScope();
    r.toggleable({ default: true });
    r.entity("product-audit", productAuditEntity);

    r.entityHook("postSave", "product", async (result, ctx) => {
      if (result.kind !== "save" || !result.isNew) return;
      if (!ctx.db) return;
      const name = (result.changes as Record<string, unknown>)["name"] as string | undefined;
      if (!name) return;
      await ctx.db.insert(productAuditTable).values({
        id: generateId(),
        productName: name,
        version: 1,
        tenantId: SYSTEM_TENANT_ID,
        createdAt: Temporal.Now.instant(),
        modifiedAt: Temporal.Now.instant(),
      });
    });
  });
}
