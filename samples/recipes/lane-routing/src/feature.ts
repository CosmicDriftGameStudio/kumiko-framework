// Lane-Routing Sample
//
// Shows `r.job({ runIn: "worker" })` end-to-end: an HTTP write emits an
// event, the event fans out to two worker-lane jobs via BullMQ, and the
// jobs actually execute on the worker lane (kumiko-jobs-worker queue).
//
// Deploy-shape: any of the three entrypoints. The test uses
// createAllInOneEntrypoint so the Single Integration-Test covers the full
// path without having to coordinate two processes.

import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// In-memory collectors so the integration-test can assert both jobs ran
// and got the right payload. A real app would do DB writes, HTTP calls,
// PDF rendering, mail sending — whatever the side-effect is, it's
// opaque to the framework.
export const renderedReceipts: Array<{ orderId: string; amount: number }> = [];
export const sentConfirmations: Array<{ orderId: string; amount: number }> = [];
export const pruneRuns: number[] = [];

// The entity declaration secures the qualified-name prefix "orders:write:order:create"
// for the write handler below. The handler does not persist the entity — it
// appends the "order-placed" event the jobs trigger on; in a real app an
// entityWriteHandler would write to the DB.
const orderEntity = createEntity({
  name: "order",
  table: "read_orders",
  fields: {
    customerName: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    amount: createNumberField({ required: true }),
  },
});

export function createLaneRoutingFeature(): FeatureDefinition {
  return defineFeature("orders", (r) => {
    r.entity(orderEntity);

    // The event both jobs trigger on. No PII: customerName stays out of it.
    r.defineEvent("order-placed", z.object({ orderId: z.string(), amount: z.number() }), {
      piiFields: "none",
    });

    // Write handler — runs in the API process (or wherever the command
    // lands) and appends the event the jobs consume.
    r.writeHandler({
      name: "order:create",
      schema: z.object({
        customerName: z.string().min(1),
        amount: z.number().positive(),
      }),
      handler: async (event, ctx) => {
        const orderId = crypto.randomUUID();
        await ctx.events.append({
          aggregateId: orderId,
          aggregateType: "order",
          type: "orders:event:order-placed",
          payload: { orderId, amount: event.payload.amount },
          expectedVersion: 0,
        });
        return {
          isSuccess: true as const,
          data: {
            id: orderId,
            customerName: event.payload.customerName,
            amount: event.payload.amount,
          },
        };
      },
      access: {
        openToAll: {
          reason:
            "demo recipe: any signed-in user may place an order; the handler is a stub with no persistence",
        },
      },
    });

    // Receipt-rendering: heavy CPU work. Pinned to `worker` so the
    // BullMQ consumer on the API process never picks it up — even if the
    // API happens to run runLocalJobs for something else. `runIn` is the
    // Welle-2.6 contract that makes this stable across deploy shapes.
    r.job({ name: "render-receipt", trigger: { on: "order-placed" },
        runIn: "worker", handler: async (payload) => {
        renderedReceipts.push({
          orderId: payload["orderId"] as string,
          amount: payload["amount"] as number,
        });
      } });

    // Confirmation-mail: external I/O. Also worker-lane. Both jobs fan
    // out from the same event in parallel — BullMQ handles their order
    // independently.
    r.job({ name: "send-confirmation", trigger: { on: "order-placed" },
        runIn: "worker", handler: async (payload) => {
        sentConfirmations.push({
          orderId: payload["orderId"] as string,
          amount: payload["amount"] as number,
        });
      } });

    // Housekeeping: `maintenance` runs once a day in the app's maintenance window
    // (KUMIKO_MAINTENANCE_WINDOW, UTC, default 03:00) instead of a cron time of its own, so a
    // sleeping app wakes once a day for all its cleanup jobs.
    r.job({ name: "prune-old-receipts", trigger: { maintenance: true }, runIn: "worker", handler: async () => {
      pruneRuns.push(Date.now());
    } });

    // Optional upkeep: `wakesSleepingApp: false` keeps a sleeping shared app asleep when a run is
    // due; the run happens on the next wake instead.
    r.job({ name: "warm-receipt-cache", trigger: { cron: "*/15 * * * *", wakesSleepingApp: false }, runIn: "worker", handler: async () => {} });
  });
}
