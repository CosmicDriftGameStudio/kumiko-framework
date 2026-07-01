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

import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  buildEntityTable,
  createEventStoreExecutor,
  integer,
  selectMany,
  table,
  text,
  updateMany,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import type { PipelineCtx } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  defineWriteHandler,
  pipeline,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const LOW_STOCK_THRESHOLD = 10;

export const productEntity = createEntity({
  table: "read_inventory_products",
  fields: {
    sku: createTextField({ required: true }),
    name: createTextField({ required: true }),
    currentStock: createNumberField({ default: 0 }),
  },
});

// Custom non-aggregate projection. The boot-validator allows direct
// upsert/delete only because `r.requires.projection(...)` is declared
// inside the feature below — without that line, boot fails fast.
export const lowStockAlertsTable: EntityTableMeta = table("read_inventory_low_stock_alerts", {
  productId: uuid("product_id").primaryKey(),
  sku: text("sku").notNull(),
  currentStock: integer("current_stock").notNull(),
  threshold: integer("threshold").notNull(),
});

// Module-level drizzle-table + executor — the steps below capture
// `productExecutor` from this scope, and the integration test
// imports `productTable` for raw selects.
export const productTable = buildEntityTable("product", productEntity);
const productExecutor = createEventStoreExecutor(productTable, productEntity, {
  entityName: "product",
});

export const inventoryFeature = defineFeature("inventory", (r) => {
  r.entity("product", productEntity);
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
  );

  const archived = r.defineEvent("product-archived", z.object({ reason: z.string() }));

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

  // -------------------------------------------------------------
  // 1. inventory:product:create — straight aggregate.create.
  //    Simplest pipeline form: one mutating step + return.
  // -------------------------------------------------------------
  r.writeHandler(
    defineWriteHandler({
      name: "product:create",
      schema: z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        initialStock: z.number().int().min(0).default(0),
      }),
      access: { roles: ["Admin"] },
      perform: pipeline<{ sku: string; name: string; initialStock: number }, { id: string }>(
        ({ event, r }) => [
          r.step.aggregate.create("product", {
            executor: productExecutor,
            data: () => ({
              sku: event.payload.sku,
              name: event.payload.name,
              currentStock: event.payload.initialStock,
            }),
          }),
          r.step.return(({ steps }) => ({
            isSuccess: true as const,
            data: { id: (steps["product"] as { id: string }).id },
          })),
        ],
      ),
    }),
  );

  // -------------------------------------------------------------
  // 2. inventory:product:rename — read + branch (skip-if-noop).
  //    Demonstrates the read-then-conditional-write pattern.
  //    The aggregate.update inside `onTrue` only runs when the
  //    name actually changed — saves an event + a projection
  //    write per redundant rename.
  // -------------------------------------------------------------
  r.writeHandler(
    defineWriteHandler({
      name: "product:rename",
      schema: z.object({ id: z.uuid(), name: z.string().min(1) }),
      access: { roles: ["Admin"] },
      perform: pipeline<{ id: string; name: string }, { id: string; renamed: boolean }>(
        ({ event, r }) => [
          r.step.read.findOne("current", {
            table: productTable,
            where: () => ({ id: event.payload.id }),
          }),
          r.step.branch({
            if: ({ steps }) => {
              const cur = steps["current"] as { name: string } | null;
              return cur !== null && cur.name !== event.payload.name;
            },
            onTrue: [
              r.step.aggregate.update("product", {
                executor: productExecutor,
                id: () => event.payload.id,
                version: ({ steps }) => (steps["current"] as { version?: number } | null)?.version,
                changes: () => ({ name: event.payload.name }),
              }),
            ],
          }),
          r.step.return(({ steps }) => ({
            isSuccess: true as const,
            data: {
              id: event.payload.id,
              // Truthy iff the aggregate.update step actually ran —
              // the executor lands its SaveContext under steps.product.
              renamed: steps["product"] !== undefined,
            },
          })),
        ],
      ),
    }),
  );

  // -------------------------------------------------------------
  // 3. inventory:product:adjust-stock — every Tier-1 step in one
  //    handler. Production-realistic: read aggregate, compute new
  //    stock, persist update, append a domain-event for the
  //    audit-trail, then upsert OR delete the low-stock-alert
  //    based on whether the new stock crosses the threshold.
  // -------------------------------------------------------------
  r.writeHandler(
    defineWriteHandler({
      name: "product:adjust-stock",
      schema: z.object({
        id: z.uuid(),
        delta: z.number().int(),
        reason: z.string().min(1),
      }),
      access: { roles: ["Admin", "User"] },
      perform: pipeline<
        { id: string; delta: number; reason: string },
        { id: string; newStock: number }
      >(({ event, r }) => [
        r.step.read.findOne("current", {
          table: productTable,
          where: () => ({ id: event.payload.id }),
        }),
        r.step.compute("newStock", ({ steps }) => {
          const cur = steps["current"] as { currentStock: number } | null;
          if (!cur) {
            throw new Error(`product not found: ${event.payload.id}`);
          }
          return cur.currentStock + event.payload.delta;
        }),
        // Pure-ES: emit the domain event; the inline `product-stock-counter`
        // projection above replays it onto the product row in the same TX.
        // No aggregate.update here — see the projection's comment for why
        // the split is intentional.
        r.step.aggregate.appendEvent({
          aggregateId: () => event.payload.id,
          aggregateType: "product",
          type: stockAdjusted.name,
          // Explicit ctx-type: payload's resolver is StepResolver<unknown>,
          // which prevents TS from inferring `ctx.steps` shape via the
          // destructure. Followup #4 (TData-Inference) tracks the DX-fix.
          payload: ({ steps }: PipelineCtx) => ({
            delta: event.payload.delta,
            reason: event.payload.reason,
            newStock: steps["newStock"] as number,
          }),
        }),
        // Inline projection-maintenance: cross the threshold in
        // either direction in the same TX as the aggregate write.
        // Async multi-stream projections would lag here — this is
        // the use-case for inline unsafeProjection.*.
        r.step.branch({
          if: ({ steps }) => (steps["newStock"] as number) < LOW_STOCK_THRESHOLD,
          onTrue: [
            r.step.unsafeProjectionUpsert({
              table: lowStockAlertsTable,
              on: ["productId"],
              row: ({ steps }) => {
                const cur = steps["current"] as { sku: string };
                return {
                  productId: event.payload.id,
                  sku: cur.sku,
                  currentStock: steps["newStock"] as number,
                  threshold: LOW_STOCK_THRESHOLD,
                };
              },
            }),
          ],
          onFalse: [
            r.step.unsafeProjectionDelete({
              table: lowStockAlertsTable,
              where: () => ({ productId: event.payload.id }),
            }),
          ],
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: {
            id: event.payload.id,
            newStock: steps["newStock"] as number,
          },
        })),
      ]),
    }),
  );

  // -------------------------------------------------------------
  // 4. inventory:product:bulk-adjust — forEach over a list of
  //    adjustments. Each iteration is its own read+update mini-
  //    pipeline; `scope.adj` is the per-iteration item.
  //    Sequential by design (concurrency=1 in M.1.6).
  // -------------------------------------------------------------
  r.writeHandler(
    defineWriteHandler({
      name: "product:bulk-adjust",
      schema: z.object({
        adjustments: z.array(z.object({ id: z.uuid(), delta: z.number().int() })).min(1),
      }),
      access: { roles: ["Admin"] },
      perform: pipeline<
        { adjustments: ReadonlyArray<{ id: string; delta: number }> },
        { processed: number }
      >(({ event, r }) => [
        r.step.forEach({
          over: () => event.payload.adjustments,
          as: "adj",
          do: [
            r.step.read.findOne("current", {
              table: productTable,
              where: ({ scope }) => ({ id: (scope["adj"] as { id: string }).id }),
            }),
            r.step.compute("newStock", ({ steps, scope }) => {
              const cur = steps["current"] as { currentStock: number } | null;
              const adj = scope["adj"] as { delta: number };
              if (!cur) throw new Error("product not found in bulk-adjust");
              return cur.currentStock + adj.delta;
            }),
            r.step.aggregate.update("product", {
              executor: productExecutor,
              id: ({ scope }) => (scope["adj"] as { id: string }).id,
              version: ({ steps }) => (steps["current"] as { version?: number } | null)?.version,
              changes: ({ steps }) => ({ currentStock: steps["newStock"] as number }),
              // Pure update path inside forEach — no appendEvent
              // alongside, so optimistic-locking stays meaningful.
            }),
          ],
        }),
        r.step.return(() => ({
          isSuccess: true as const,
          data: { processed: event.payload.adjustments.length },
        })),
      ]),
    }),
  );

  // -------------------------------------------------------------
  // 5. inventory:product:archive — domain-event + projection
  //    cleanup. The aggregate is preserved (event-sourced!), the
  //    side-projection row gets purged in the same TX. Reads
  //    against archived products still work via loadAggregate;
  //    list-views skip them by filtering on the archived event.
  // -------------------------------------------------------------
  r.writeHandler(
    defineWriteHandler({
      name: "product:archive",
      schema: z.object({ id: z.uuid(), reason: z.string().min(1) }),
      access: { roles: ["Admin"] },
      perform: pipeline<{ id: string; reason: string }, { id: string }>(({ event, r }) => [
        r.step.aggregate.appendEvent({
          aggregateId: () => event.payload.id,
          aggregateType: "product",
          type: archived.name,
          payload: () => ({ reason: event.payload.reason }),
        }),
        r.step.unsafeProjectionDelete({
          table: lowStockAlertsTable,
          where: () => ({ productId: event.payload.id }),
        }),
        r.step.return(() => ({
          isSuccess: true as const,
          data: { id: event.payload.id },
        })),
      ]),
    }),
  );

  // -------------------------------------------------------------
  // 6. inventory:report:bulk-archive-stale — forEach + read.findMany.
  //    Demonstrates the read-list-then-loop pattern: pull a slice
  //    of low-stock alerts via read.findMany, archive each. Used
  //    by the integration test to prove findMany lands rows under
  //    steps.<name> as an array.
  // -------------------------------------------------------------
  r.writeHandler(
    defineWriteHandler({
      name: "report:archive-low-stock-products",
      schema: z.object({ reason: z.string().min(1) }),
      access: { roles: ["Admin"] },
      perform: pipeline<{ reason: string }, { archivedCount: number }>(({ event, r }) => [
        r.step.read.findMany("alerts", {
          table: lowStockAlertsTable,
        }),
        r.step.forEach<{ productId: string }>({
          over: ({ steps }) => (steps["alerts"] as ReadonlyArray<{ productId: string }>) ?? [],
          as: "alert",
          do: [
            r.step.aggregate.appendEvent({
              aggregateId: ({ scope }) => (scope["alert"] as { productId: string }).productId,
              aggregateType: "product",
              type: archived.name,
              payload: () => ({ reason: event.payload.reason }),
            }),
            r.step.unsafeProjectionDelete({
              table: lowStockAlertsTable,
              where: ({ scope }) => ({
                productId: (scope["alert"] as { productId: string }).productId,
              }),
            }),
          ],
        }),
        r.step.return(({ steps }) => ({
          isSuccess: true as const,
          data: {
            archivedCount: (steps["alerts"] as ReadonlyArray<unknown>).length,
          },
        })),
      ]),
    }),
  );

  // -------------------------------------------------------------
  // Query handlers — free-form. M.1's pipeline-engine is write-
  // only; queries get the existing handler signature. The list
  // below is what the integration test reads against.
  // -------------------------------------------------------------
  r.queryHandler(
    "low-stock-alerts:list",
    z.object({}),
    async (_query, ctx) => {
      const rows = await selectMany(ctx.db, lowStockAlertsTable);
      return { rows };
    },
    { access: { roles: ["Admin"] } },
  );
});
