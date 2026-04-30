// Cross-Feature Reactions Sample (Marten gold-standard path)
//
// Demonstrates the Sprint-E pattern for reacting to events across features:
// a writeHandler emits a DOMAIN event via `ctx.appendEvent(...)` onto the
// aggregate's own stream, and a `r.multiStreamProjection` picks it up
// asynchronously through the event-dispatcher.
//
// Three moving pieces:
//
//   1. `r.defineEvent("short-name", zodSchema)` declares the event shape.
//      Returns a def whose `.name` is the fully-qualified event name —
//      pass that straight to `ctx.appendEvent` so there's no string to
//      hand-type (and no way to emit an unregistered event: appendEvent
//      rejects at the emit site).
//
//   2. `ctx.appendEvent({ aggregateId, aggregateType, type, payload })`
//      writes the event onto the aggregate's own stream inside the same
//      transaction as the business write. Commit both or roll back both —
//      no lost events, no orphan events. The event carries real
//      aggregate/version lineage (Marten-aligned).
//
//   3. `r.multiStreamProjection({ name, apply })` declares an async
//      consumer. The event-dispatcher walks the events-table via a
//      persistent cursor and invokes the matching apply() handler
//      at-least-once in events.id order.
//
// With `table` omitted the MSP is a pure side-effect consumer —
// send notifications, post webhooks, sync external systems. The tx
// argument is still live for the apply() if you need it.

import { z } from "zod";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  emitEvent,
  typedPayload,
} from "../.kumiko/define";

// --- Entity ---

export const orderEntity = createEntity({
  table: "read_sample_pubsub_orders",
  fields: {
    customer: createTextField({ required: true }),
    product: createTextField({ required: true }),
  },
});

// --- Subscriber capture (for the integration test) ---
//
// Real consumers would write to a downstream store or call an external
// service. Here we capture in-memory so the test can assert the roundtrip.
// Exported so the test can import + reset between cases.

export type CapturedEvent = {
  readonly type: string;
  readonly payload: { readonly id: unknown; readonly customer: string };
  readonly tenantId: string;
};
export const capturedEvents: CapturedEvent[] = [];

// --- Feature ---

export const pubsubOrderFeature = defineFeature("pubsubOrders", (r) => {
  r.entity("pubsub-order", orderEntity);

  // Define the event shape once. The returned `.name` is the qualified
  // name ("pubsub-orders:event:order-placed") — pass it to ctx.appendEvent.
  const orderPlaced = r.defineEvent(
    "order-placed",
    z.object({ id: z.string(), customer: z.string(), product: z.string() }),
  );

  const { executor: orderExecutor } = createEntityExecutor("pubsub-order", orderEntity);

  r.writeHandler(
    "order:place",
    z.object({ customer: z.string().min(1), product: z.string().min(1) }),
    async (event, ctx) => {
      const result = await orderExecutor.create(event.payload, event.user, ctx.db);
      if (result.isSuccess) {
        // emitEvent runs inside the executor's TX and is typed against
        // the orderPlaced event-def — a wrong payload shape is a compile
        // error, not a runtime Zod reject. The event lands on the order's
        // OWN stream (aggregateType "pubsub-order"), with the correct
        // version bumped automatically. Schema validation still runs at
        // append-time; a mismatch rolls back the whole write.
        await emitEvent(ctx, orderPlaced, {
          aggregateId: String(result.data.id),
          aggregateType: "pubsub-order",
          payload: {
            id: String(result.data.id),
            customer: event.payload.customer,
            product: event.payload.product,
          },
        });
      }
      return result;
    },
    { access: { roles: ["Admin", "Customer"] } },
  );

  // Async consumer — Marten-style. Fires after commit, via the event-
  // dispatcher. No `table` means this MSP is pure side-effect (no state
  // persisted). Delivery is at-least-once and ordered per consumer.
  r.multiStreamProjection({
    name: "record-order-placed",
    apply: {
      [orderPlaced.name]: async (event) => {
        const payload = typedPayload(event, orderPlaced);
        capturedEvents.push({
          type: event.type,
          payload,
          tenantId: event.tenantId,
        });
      },
    },
  });
});
