// Custom Handlers Sample
// Shows: writeHandler with business logic, queryHandler with custom filtering,
// handler that modifies payload before DB write.

import {
  createEntity,
  createEntityExecutor,
  createNumberField,
  createTextField,
  defineFeature,
} from "@kumiko/framework/engine";
import { failNotFound } from "@kumiko/framework/errors";
import { z } from "zod";

export const counterEntity = createEntity({
  table: "read_sample_counters",
  fields: {
    name: createTextField({ required: true }),
    count: createNumberField({ default: 0 }),
    lastIncrementedBy: createTextField(),
  },
});

export const counterFeature = defineFeature("counters", (r) => {
  r.entity("counter", counterEntity);

  // createEntityExecutor bundles buildDrizzleTable + createEventStoreExecutor —
  // the same pair every custom write-handler opens with. Collapses 3 lines
  // + the { entityName } bookkeeping into one destructure.
  const { executor: counterExecutor } = createEntityExecutor("counter", counterEntity);

  // Standard create
  r.writeHandler(
    "counter:create",
    z.object({ name: z.string().min(1) }),
    async (event, ctx) =>
      counterExecutor.create({ ...event.payload, count: 0 }, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  // Custom handler: increment with business logic
  r.writeHandler(
    "counter:increment",
    z.object({ id: z.uuid(), amount: z.number().min(1).max(100) }),
    async (event, ctx) => {
      const current = await counterExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
      if (!current) {
        return failNotFound("counter", event.payload.id);
      }

      const newCount = (current["count"] as number) + event.payload.amount;
      // Read-modify-write on counter: use the version we just read so two
      // concurrent increments don't clobber each other's changes.
      return counterExecutor.update(
        {
          id: event.payload.id,
          version: current["version"] as number,
          changes: { count: newCount, lastIncrementedBy: `user:${event.user.id}` },
        },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: ["Admin", "User"] } },
  );

  // Custom handler: reset to zero
  r.writeHandler(
    "counter:reset",
    z.object({ id: z.uuid() }),
    async (event, ctx) =>
      // Admin reset: last-writer-wins is intentional — there's no useful
      // concurrent-reset race to guard against.
      counterExecutor.update(
        { id: event.payload.id, changes: { count: 0, lastIncrementedBy: "" } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      ),
    { access: { roles: ["Admin"] } },
  );

  // Custom query: only counters above a threshold
  r.queryHandler(
    "counter:active",
    z.object({ minCount: z.number().default(1) }),
    async (query, ctx) => {
      const all = await counterExecutor.list({}, query.user, ctx.db);
      return {
        ...all,
        rows: all.rows.filter((r) => (r["count"] as number) >= query.payload.minCount),
      };
    },
    { access: { openToAll: true } },
  );

  // Standard detail
  r.queryHandler(
    "counter:detail",
    z.object({ id: z.uuid() }),
    async (query, ctx) => counterExecutor.detail(query.payload, query.user, ctx.db),
    { access: { openToAll: true } },
  );
});
