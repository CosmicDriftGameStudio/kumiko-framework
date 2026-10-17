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

// detail() returns an untyped row; parse the two fields the increment needs once.
const counterVersionRowSchema = z.object({ count: z.number(), version: z.number() });

export const counterEntity = createEntity({
  table: "read_sample_counters",
  fields: {
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
    count: createNumberField({ default: 0 }),
    lastIncrementedBy: createTextField({ personal: "ref" }),
  },
});

export const counterFeature = defineFeature("counters", (r) => {
  r.entity("counter", counterEntity);

  // createEntityExecutor bundles buildEntityTable + createEventStoreExecutor —
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

      const { count, version } = counterVersionRowSchema.parse(current);
      const newCount = count + event.payload.amount;
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

  // Custom query: only counters above a threshold. list() returns one page
  // (default 50, max 200, MAX_LIST_LIMIT), so a JS filter would miss rows after
  // page 1; filter in the query instead. totalCount counts over the whole WHERE.
  r.queryHandler(
    "counter:active",
    z.object({ minCount: z.number().int().default(1), cursor: z.string().optional() }),
    async (query, ctx) =>
      counterExecutor.list(
        {
          filter: { field: "count", op: "gte", value: query.payload.minCount },
          totalCount: true,
          cursor: query.payload.cursor,
        },
        query.user,
        ctx.db,
      ),
    {
      access: {
        openToAll: {
          reason:
            "any signed-in user may list active counters; the sample has no per-user counter ownership",
        },
      },
    },
  );

  // Standard detail
  r.queryHandler(
    "counter:detail",
    z.object({ id: z.uuid() }),
    async (query, ctx) => counterExecutor.detail(query.payload, query.user, ctx.db),
    {
      access: {
        openToAll: {
          reason:
            "any signed-in user may read a counter by id; the sample has no per-user counter ownership",
        },
      },
    },
  );
});
