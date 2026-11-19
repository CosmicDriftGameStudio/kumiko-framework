// Pipeline Basics — Inventory-Management Showcase
//
// Production-pattern sample that exercises every Tier-1 step from
// the M.1 step-vocabulary in a single feature. The handlers below
// are the canonical reference for "what the pipeline form looks
// like in real code"; the M.3 codemod (later) will translate the
// free-form `custom-handlers` sample into roughly this shape.
//
// Steps covered:
//   - r.step.aggregate.create / aggregate.update / aggregate.appendEvent
//   - r.step.read.findOne / read.findMany
//   - r.step.compute / branch / forEach / return
//   - r.step.unsafeProjectionUpsert / unsafeProjectionDelete
//
// Domain: products with a current-stock counter. Stock-adjustments
// are tracked as domain events on the product stream (in addition
// to the auto-CRUD updated-event). A custom non-aggregate
// projection (`low_stock_alerts`) gets upserted/deleted inline
// whenever stock crosses a threshold — exactly the use-case the
// `unsafe`-prefix is designed for: framework-author opting into
// raw projection-writes after seeing the prefix at every call site.

import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { createProductAdjustStockWrite } from "./handlers/product-adjust-stock.write";
import { createProductArchiveWrite } from "./handlers/product-archive.write";
import { productBulkAdjustWrite } from "./handlers/product-bulk-adjust.write";
import { productCreateWrite } from "./handlers/product-create.write";
import { productRenameWrite } from "./handlers/product-rename.write";
import { createReportArchiveLowStockProductsWrite } from "./handlers/report-archive-low-stock-products.write";
import { lowStockAlertsTable, productEntity, productTable } from "./schema";

export const inventoryFeature = defineFeature("inventory", (r) => {
  r.entity(productEntity);
  r.requires.projection("read_inventory_low_stock_alerts");

  // Domain-events on the product stream (alongside the auto-CRUD
  // events). r.defineEvent registers them globally — the `type`
  // field of aggregate.appendEvent is a plain string, but using
  // `<eventDef>.name` here gives type-safe aliasing if the event
  // is later renamed.
  const stockAdjusted = r.defineEvent(
    "product-stock-adjusted",
    z.object({
      delta: z.number().int(),
      reason: z.string(),
      newStock: z.number().int(),
    }),
    { piiFields: "none" },
  );

  const archived = r.defineEvent("product-archived", z.object({ reason: z.string() }), {
    piiFields: "none",
  });

  // Inline projection that maintains `currentStock` from the
  // stock-adjusted domain event. Pure event-sourcing pattern: the
  // adjust-stock handler does NOT call aggregate.update — it only
  // appends the domain event, and this projection (running in the
  // same TX) replays its effect onto the product row.
  //
  // Why pure-ES (rather than aggregate.update + appendEvent in one
  // handler): combining the two inflates the stream-version mid-
  // handler, which would trip optimistic-locking on a back-to-back
  // adjust-stock call. The split-here is the canonical Marten/CQRS
  // shape — domain events are the source of truth, projections are
  // the queryable view.
  r.projection({
    name: "product-stock-counter",
    source: "product",
    table: productTable,
    apply: {
      [stockAdjusted.name]: async (event, tx, table) => {
        const p = event.payload as { newStock: number };
        await updateMany(tx, table, { currentStock: p.newStock }, { id: event.aggregateId });
      },
    },
  });

  r.writeHandler(productCreateWrite);
  r.writeHandler(productRenameWrite);
  r.writeHandler(createProductAdjustStockWrite(stockAdjusted.name));
  r.writeHandler(productBulkAdjustWrite);
  r.writeHandler(createProductArchiveWrite(archived.name));
  r.writeHandler(createReportArchiveLowStockProductsWrite(archived.name));

  // -------------------------------------------------------------
  // Query handlers — free-form. M.1's pipeline-engine is write-
  // only; queries get the existing handler signature. The list
  // below is what the integration test reads against.
  // -------------------------------------------------------------
  r.queryHandler({
    name: "low-stock-alerts:list",
    schema: z.object({}),
    handler: async (_query, ctx) => {
      const rows = await selectMany(ctx.db, lowStockAlertsTable);
      return { rows };
    },
    access: { roles: ["Admin"] },
  });
});
