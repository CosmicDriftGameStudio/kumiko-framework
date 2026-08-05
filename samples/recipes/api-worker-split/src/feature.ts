// API/Worker-Split Sample
//
// Proves the split deploy topology end-to-end (kumiko-platform#512):
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

import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { table, text, uuid } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

// Single-tenant sample: one fixed tenant for the worker's system write.
// Multi-tenant apps resolve this from the event/request instead.
export const SAMPLE_TENANT_ID = "00000000-0000-4000-8000-000000000001" as const;

const openAccess = { access: { openToAll: true } } as const;

// --- Entities ------------------------------------------------------------
// Both are plain event-sourced CRUD entities. The write handler rows are
// written synchronously by the event-store executor — the API process
// always sees them, split or not.

export const orderEntity = createEntity({
  table: "read_orders",
  fields: {
    customerName: createTextField({ required: true }),
    amount: createNumberField({ required: true }),
    status: createTextField({ default: "pending" }),
  },
});

export const fulfillmentEntity = createEntity({
  table: "read_fulfillments",
  fields: {
    orderKey: createTextField({ required: true }),
    carrier: createTextField({ required: true }),
    label: createTextField({ required: true }),
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
}) => Promise<unknown>;

let fulfillWrite: FulfillWrite | undefined;

/** Called by bin/worker.ts (wireComponents) with dispatchSystemWrite. */
export function setOrderFulfillWrite(fn: FulfillWrite): void {
  fulfillWrite = fn;
}

export function createApiWorkerSplitFeature() {
  return defineFeature("orders", (r) => {
    r.crud("order", orderEntity, { write: openAccess, read: openAccess });
    r.crud("fulfillment", fulfillmentEntity, { write: openAccess, read: openAccess });

    // Heavy follow-up work, pinned to the worker lane: the API process only
    // enqueues (its BullMQ client, no consumer), the worker executes.
    r.job(
      "process-order",
      {
        trigger: { on: "orders:write:order:create" },
        runIn: "worker",
      },
      async (payload) => {
        if (fulfillWrite === undefined) {
          throw new Error(
            "process-order: no fulfill-write bridge wired — bin/worker.ts must call setOrderFulfillWrite at boot",
          );
        }
        const customerName = payload["customerName"] as string;
        await fulfillWrite({
          handlerQn: "orders:write:fulfillment:create",
          payload: {
            orderKey: customerName,
            carrier: "DHL",
            label: `label-${customerName}`,
          },
          tenantId: SAMPLE_TENANT_ID,
        });
      },
    );

    // Async read model, applied by the WORKER's event-dispatcher. Entity ids
    // are generated at write time and are not part of the job payload — the
    // projection keys off the natural key (customerName), the same way a
    // background write-back would. Note the event type: the write-handler QN
    // ("orders:write:order:create") triggers jobs synchronously, but the
    // STORED event is the entity event "order.created" — that's what the
    // async dispatcher routes on.
    r.multiStreamProjection({
      name: "order-activity",
      table: orderActivityTable,
      apply: {
        "order.created": async (event, tx) => {
          const payload = event.payload as { customerName: string };
          await insertOne(tx, orderActivityTable, {
            tenantId: event.tenantId,
            orderKey: payload.customerName,
          });
        },
      },
    });
  });
}
