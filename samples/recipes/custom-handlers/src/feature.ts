// Custom Handlers Sample
// Shows: writeHandler with business logic, queryHandler with a server-side filter,
// handler that modifies payload before DB write.

import {
  createEntity,
  createEntityExecutor,
  createNumberField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

export const counterEntity = createEntity({
  table: "read_sample_counters",
  fields: {
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
    count: createNumberField({ default: 0 }),
    lastIncrementedBy: createTextField({ personal: "ref" }),
  },
});

export const counterFeature = defineFeature("counters", (r) => {
  r.entity({ name: "counter", ...counterEntity });

  // createEntityExecutor bundles buildEntityTable + createEventStoreExecutor —
  // the same pair every custom write-handler opens with. Collapses 3 lines
  // + the { entityName } bookkeeping into one destructure.
  const { executor: counterExecutor } = createEntityExecutor("counter", counterEntity);

  // Standard create
  r.writeHandler({
    name: "counter:create",
    schema: z.object({ name: z.string().min(1) }),
    handler: async (event, ctx) =>
      counterExecutor.create({ ...event.payload, count: 0 }, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  // Custom handler: increment with business logic
  r.writeHandler({
    name: "counter:increment",
    schema: z.object({ id: z.uuid(), amount: z.number().min(1).max(100) }),
    handler: async (event, ctx) => {
      const current = await counterExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
      if (!current) {
        return failNotFound("counter", event.payload.id);
      }

      // detail() returns the entity's own row type; count is nullable because the field is not required.
      const { count, version } = current;
      const newCount = (count ?? 0) + event.payload.amount;
      // Read-modify-write on counter: use the version we just read so two
      // concurrent increments don't clobber each other's changes.
      return counterExecutor.update(
        {
          id: event.payload.id,
          version,
          changes: { count: newCount, lastIncrementedBy: `user:${event.user.id}` },
        },
        event.user,
        ctx.db,
      );
    },
    access: { roles: ["Admin", "User"] },
  });

  // Custom handler: reset to zero
  r.writeHandler({
    name: "counter:reset",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      // Admin reset: last-writer-wins is intentional — there's no useful
      // concurrent-reset race to guard against.
      counterExecutor.update(
        { id: event.payload.id, changes: { count: 0, lastIncrementedBy: "" } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      ),
    access: { roles: ["Admin"] },
  });

  // Custom query: only counters above a threshold. list() returns one page
  // (default 50, max 200, MAX_LIST_LIMIT), so a JS filter would miss rows after
  // page 1; filter in the query instead. totalCount counts over the whole WHERE.
  r.queryHandler({
    name: "counter:active",
    schema: z.object({ minCount: z.number().int().default(1), cursor: z.string().optional() }),
    handler: async (query, ctx) =>
      counterExecutor.list(
        {
          filter: { field: "count", op: "gte", value: query.payload.minCount },
          totalCount: true,
          cursor: query.payload.cursor,
        },
        query.user,
        ctx.db,
      ),
    access: {
      openToAll: {
        reason:
          "any signed-in user may list active counters; the sample has no per-user counter ownership",
      },
    },
  });

  // Standard detail
  r.queryHandler({
    name: "counter:detail",
    schema: z.object({ id: z.uuid() }),
    handler: async (query, ctx) => counterExecutor.detail(query.payload, query.user, ctx.db),
    access: {
      openToAll: {
        reason:
          "any signed-in user may read a counter by id; the sample has no per-user counter ownership",
      },
    },
  });
});
