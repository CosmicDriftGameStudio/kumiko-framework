// Custom Handlers Sample
// Shows: writeHandler with business logic, queryHandler with a server-side filter,
// handler that modifies payload before DB write, named entity verbs (counter.archived,
// counter.reset) with a checked transition, and the executor's history and as-of reads.

import {
  createEntity,
  createEntityExecutor,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

export const counterEntity = createEntity({
  name: "counter",
  table: "read_sample_counters",
  fields: {
    name: createTextField({ personal: false, reason: "is_business_data", required: true }),
    count: createNumberField({ default: 0 }),
    lastIncrementedBy: createTextField({ personal: "ref" }),
    status: createSelectField({ options: ["open", "archived"], default: "open" }),
  },
  verbs: {
    archived: { transition: { field: "status", from: ["open"], to: "archived" } },
    reset: {},
  },
});

export const counterFeature = defineFeature("counters", (r) => {
  r.entity(counterEntity);

  // createEntityExecutor bundles buildEntityTable + createEventStoreExecutor —
  // the same pair every custom write-handler opens with. Collapses 3 lines
  // + the { entityName } bookkeeping into one destructure.
  const { executor: counterExecutor } = createEntityExecutor(counterEntity);

  // Standard create
  r.writeHandler({
    name: "counter:create",
    schema: z.object({ name: z.string().min(1) }),
    handler: async (event, ctx) =>
      counterExecutor.create({ ...event.payload, count: 0 }, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  // Many rows in one handler: one append statement for all events, all or nothing
  r.writeHandler({
    name: "counter:create-many",
    schema: z.object({ names: z.array(z.string().min(1)).min(1).max(100) }),
    handler: async (event, ctx) => {
      const result = await counterExecutor.createMany(
        event.payload.names.map((name) => ({ name, count: 0 })),
        event.user,
        ctx.db,
      );
      if (!result.isSuccess) return result;
      return { isSuccess: true, data: { ids: result.data.map((saved) => saved.id) } };
    },
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
        { skipOptimisticLock: true, verb: "reset" },
      ),
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "counter:archive",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) =>
      // The executor checks the transition and sets status.
      counterExecutor.update({ id: event.payload.id, changes: {} }, event.user, ctx.db, {
        skipOptimisticLock: true,
        verb: "archived",
      }),
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

  r.queryHandler({
    name: "counter:history",
    schema: z.object({ id: z.uuid() }),
    handler: async (query, ctx) =>
      counterExecutor.history({ id: query.payload.id }, query.user, ctx.db),
    access: {
      openToAll: {
        reason:
          "any signed-in user may read a counter's history; the sample has no per-user counter ownership",
      },
    },
  });

  r.queryHandler({
    name: "counter:as-of",
    schema: z.object({ asOf: z.iso.datetime() }),
    handler: async (query, ctx) =>
      counterExecutor.listAsOf(
        { asOf: Temporal.Instant.from(query.payload.asOf) },
        query.user,
        ctx.db,
      ),
    access: {
      openToAll: {
        reason:
          "any signed-in user may read counters as of a past instant; the sample has no per-user counter ownership",
      },
    },
  });
});
