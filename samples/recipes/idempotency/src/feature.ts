// Idempotency Sample
// Shows: requestId prevents duplicate inserts, returns cached result.
// Custom `order:place` handler so we can inject a default status — a generic
// `order:create` would not know about the business rule "new orders start as
// pending".

import { buildDrizzleTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const orderEntity = createEntity({
  table: "read_sample_orders",
  fields: {
    customerName: createTextField({ required: true }),
    product: createTextField({ required: true }),
    status: createTextField({ default: "pending" }),
  },
});

const orderTable = buildDrizzleTable("order", orderEntity);

export const orderFeature = defineFeature("orders", (r) => {
  r.entity("order", orderEntity);

  const orderExecutor = createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" });

  r.writeHandler(
    "order:place",
    z.object({
      customerName: z.string().min(1),
      product: z.string().min(1),
    }),
    async (event, ctx) =>
      orderExecutor.create({ ...event.payload, status: "pending" }, event.user, ctx.db),
    { access: { roles: ["Admin", "Customer"] } },
  );

  r.queryHandler(
    "order:list",
    z.object({ limit: z.number().optional() }),
    async (query, ctx) => orderExecutor.list(query.payload, query.user, ctx.db),
    { access: { openToAll: true } },
  );
});
