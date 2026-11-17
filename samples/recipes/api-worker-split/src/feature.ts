// API/Worker-Split Sample
//
// Proves the split deployment topology end-to-end:
//
//   - the API process runs `runSingleInstance: false` — it serves HTTP,
//     writes events, and ENQUEUES worker-lane jobs. It applies no
//     multiStreamProjections and consumes no jobs.
//   - the worker process consumes the worker-lane queue and applies the
//     multiStreamProjections the API skipped (the 2026-06-11 sharp edge:
//     without a worker the read-side stays empty, silently).
//   - a worker-lane job writes its RESULT back through the WORKER's
//     dispatcher — JobContext has no write/query (fw#1717), so the app
//     wires a write-bridge at boot (see setOrderFulfillWrite below).

import { insertOne, table, text, uuid } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";

const openAccess = {
  access: {
    openToAll: {
      reason:
        "demo recipe: any signed-in user manages every order and fulfillment; there " +
        "is no per-user ownership in this sample",
    },
  },
} as const;

// --- Entities ------------------------------------------------------------
// Both are plain event-sourced CRUD entities. The write handler rows are
// written synchronously by the event-store executor — the API process
// always sees them, split or not.

export const orderEntity = createEntity({
  name: "order",
  table: "read_orders",
  fields: {
    customerName: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    amount: createNumberField({ required: true }),
    status: createTextField({ personal: false, reason: "is_business_data", default: "pending" }),
  },
});

export const fulfillmentEntity = createEntity({
  name: "fulfillment",
  table: "read_fulfillments",
  fields: {
    orderKey: createTextField({ personal: false, reason: "is_system_identifier", required: true }),
    carrier: createTextField({ personal: false, reason: "is_business_data", required: true }),
    label: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});

// --- Worker-applied read side (the sharp edge) ----------------------------
// This projection is applied by the event-dispatcher of the WORKER process
// only. `runSingleInstance: false` turns the API's local dispatcher off, so
// this table stays empty until a worker runs — exactly the 2026-06-11
// incident class (#512).
export const orderActivityTable = table("read_order_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orderKey: text("order_key").notNull(),
});

// --- The write-bridge (fw#1717) -------------------------------------------
// JobContext deliberately has no write/query — a background job must not
// bypass the write path (idempotency, PII, transition guards). The app
// therefore wires a component with the worker's dispatcher at boot and the
// job calls it. Same pattern as inbound-mail-foundation's watch-supervisor.
type FulfillWrite = (args: {
  readonly handlerQn: string;
  readonly payload: Record<string, unknown>;
  readonly tenantId: string;
}) => Promise<WriteResult>;

let fulfillWrite: FulfillWrite | undefined;

/** Called by bin/worker.ts (wireComponents) with dispatchSystemWrite. */
export function setOrderFulfillWrite(fn: FulfillWrite): void {
  fulfillWrite = fn;
}

let carrierRetryAfterMs: () => number = () => 0;

/** Stand-in for a rate-limited carrier API: ms until it accepts work again, 0 when free. */
export function setCarrierRetryAfter(fn: () => number): void {
  carrierRetryAfterMs = fn;
}

export function createApiWorkerSplitFeature() {
  return defineFeature("orders", (r) => {
    r.crud(orderEntity, { write: openAccess, read: openAccess });
    r.crud(fulfillmentEntity, { write: openAccess, read: openAccess });

    // Heavy follow-up work, pinned to the worker lane: the API process only
    // enqueues (its BullMQ client, no consumer), the worker executes.
    r.job({ name: "process-order", trigger: { on: "order.created" },
        runIn: "worker", handler: async (_payload, context) => {
        if (fulfillWrite === undefined) {
          throw new Error(
            "process-order: no fulfill-write bridge wired — bin/worker.ts must call setOrderFulfillWrite at boot",
          );
        }
        // Every event-triggered job carries the tenant of the write that
        // fired it (job-runner sets `_tenantId` from the triggering user)
        // — reuse it instead of a fixed tenant, or a job triggered by one
        // tenant's write silently fulfills into another tenant.
        const tenantId = context.triggeredBy?.tenantId;
        if (tenantId === undefined) {
          throw new Error(
            "process-order: job context has no triggeredBy.tenantId — expected an order.created-triggered job to always carry the triggering write's tenant",
          );
        }
        // customerName is PII and arrives as ciphertext in the event payload, so the order's
        // aggregate id is the key. A missing id would write "label-undefined" instead of failing.
        const orderId = context.triggerEvent?.aggregateId;
        if (orderId === undefined) {
          throw new Error("process-order: job context has no triggerEvent.aggregateId");
        }
        // Busy is not a failure: ctx.defer re-runs the job later without burning a retry.
        // Once the defer budget is used up (or the run is inline), try anyway and let a failure retry.
        const retryAfterMs = carrierRetryAfterMs();
        if (retryAfterMs > 0 && context.canDefer) return context.defer(retryAfterMs);
        const result = await fulfillWrite({
          handlerQn: "orders:write:fulfillment:create",
          payload: {
            orderKey: orderId,
            carrier: "DHL",
            label: `label-${orderId}`,
          },
          tenantId,
        });
        if (!result.isSuccess) {
          // Throwing lets BullMQ retry the job — a silently dropped
          // fulfillment would leave the order stuck "pending" forever.
          throw new Error(
            `process-order: fulfillment create failed for order "${orderId}": ${result.error?.code ?? "unknown"}`,
          );
        }
      } });

    // Async read model, applied by the WORKER's event-dispatcher. The job and
    // the projection both route on the stored entity event "order.created"; the
    // projection keys off the event's aggregate id, the same key the job uses
    // for the fulfillment.
    r.multiStreamProjection({
      name: "order-activity",
      table: orderActivityTable,
      apply: {
        "order.created": async (event, tx) => {
          await insertOne(tx, orderActivityTable, {
            tenantId: event.tenantId,
            orderKey: event.aggregateId,
          });
        },
      },
    });
  });
}
