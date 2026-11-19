import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  integer,
  table,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const LOW_STOCK_THRESHOLD = 10;

export const productEntity = createEntity({
  name: "product",
  table: "read_inventory_products",
  fields: {
    sku: createTextField({ personal: false, reason: "is_business_data", required: true }),
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
    currentStock: createNumberField({ default: 0 }),
  },
});

// Custom non-aggregate projection. The boot-validator allows direct
// upsert/delete only because `r.requires.projection(...)` is declared
// in feature.ts — without that line, boot fails fast.
export const lowStockAlertsTable: EntityTableMeta = table("read_inventory_low_stock_alerts", {
  productId: uuid("product_id").primaryKey(),
  sku: text("sku").notNull(),
  currentStock: integer("current_stock").notNull(),
  threshold: integer("threshold").notNull(),
});

// Module-level drizzle-table + executor — the handler steps capture
// `productExecutor` from this scope, and the integration test
// imports `productTable` for raw selects.
export const productTable = buildEntityTable(productEntity);
export const productExecutor = createEventStoreExecutor(productTable, productEntity, {
  entityName: "product",
});
