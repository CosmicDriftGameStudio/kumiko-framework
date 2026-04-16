import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../db/event-store-executor";
import { buildDrizzleTable } from "../db/table-builder";
import {
  createBooleanField,
  createEntity,
  createSelectField,
  createTextField,
  defineFeature,
} from "../engine";
import {
  createEntityTable,
  expectErrorIncludes,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "../testing";

// Two entities, both with a field named `status`, but different transitions.
// Before the fix, the dispatcher cached the transition map by `fieldName`
// alone — so whichever entity ran through the pipeline first would poison
// the cache, and the other entity would be validated against the wrong map.

const invoiceEntity = createEntity({
  table: "tg_invoices",
  fields: {
    title: createTextField({ required: true }),
    status: createSelectField({ options: ["draft", "sent", "paid"] as const, default: "draft" }),
  },
  transitions: {
    status: {
      draft: ["sent"],
      sent: ["paid"],
      paid: [],
    },
  },
});

const orderEntity = createEntity({
  table: "tg_orders",
  fields: {
    title: createTextField({ required: true }),
    status: createSelectField({
      options: ["open", "shipped", "delivered"] as const,
      default: "open",
    }),
  },
  transitions: {
    status: {
      open: ["shipped"],
      shipped: ["delivered"],
      delivered: [],
    },
  },
});

// A soft-deletable entity to verify the auto-guard skips isDeleted rows.
const ticketEntity = createEntity({
  table: "tg_tickets",
  fields: {
    title: createTextField({ required: true }),
    status: createSelectField({ options: ["open", "closed"] as const, default: "open" }),
    isDeleted: createBooleanField({ default: false }),
  },
  softDelete: true,
  transitions: {
    status: {
      open: ["closed"],
      closed: [],
    },
  },
});

const invoiceTable = buildDrizzleTable("invoice", invoiceEntity);
const orderTable = buildDrizzleTable("order", orderEntity);
const ticketTable = buildDrizzleTable("ticket", ticketEntity);

const feature = defineFeature("txguard", (r) => {
  r.entity("invoice", invoiceEntity);
  r.entity("order", orderEntity);
  r.entity("ticket", ticketEntity);

  r.writeHandler(
    "invoice:create",
    z.object({ title: z.string(), status: z.string().optional() }),
    async (event, ctx) =>
      createEventStoreExecutor(invoiceTable, invoiceEntity, { entityName: "invoice" }).create(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "invoice:update",
    z.object({
      id: z.uuid(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) =>
      createEventStoreExecutor(invoiceTable, invoiceEntity, { entityName: "invoice" }).update(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "order:create",
    z.object({ title: z.string(), status: z.string().optional() }),
    async (event, ctx) =>
      createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" }).create(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "order:update",
    z.object({
      id: z.uuid(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) =>
      createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" }).update(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "ticket:create",
    z.object({ title: z.string() }),
    async (event, ctx) =>
      createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" }).create(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "ticket:delete",
    z.object({ id: z.uuid() }),
    async (event, ctx) =>
      createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" }).delete(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "ticket:update",
    z.object({
      id: z.uuid(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) =>
      createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" }).update(
        event.payload,
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await createEntityTable(stack.db.db, invoiceEntity);
  await createEntityTable(stack.db.db, orderEntity);
  await createEntityTable(stack.db.db, ticketEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("auto transition guard: per-entity transition map (cache key includes entity)", () => {
  test("entity A's transitions don't leak to entity B when both have `status`", async () => {
    // Create both rows in their default states (draft / open)
    const invoice = await stack.http.writeOk<{ id: number }>(
      "txguard:write:invoice:create",
      { title: "Inv-1" },
      admin,
    );
    const order = await stack.http.writeOk<{ id: number }>(
      "txguard:write:order:create",
      { title: "Ord-1" },
      admin,
    );

    // Invoice: draft → sent is ALLOWED by invoice transitions.
    // If the cache collided with order's map (open→shipped), the dispatcher
    // would reject "sent" as not a valid target from any known state.
    const invoiceResult = await stack.http.writeOk<Record<string, unknown>>(
      "txguard:write:invoice:update",
      { id: invoice["id"], changes: { status: "sent" }, version: 1 },
      admin,
    );
    expect((invoiceResult["data"] as Record<string, unknown>)["status"]).toBe("sent");

    // Order: open → shipped is ALLOWED by order transitions.
    // If the cache now holds invoice's map, this would be rejected.
    const orderResult = await stack.http.writeOk<Record<string, unknown>>(
      "txguard:write:order:update",
      { id: order["id"], changes: { status: "shipped" }, version: 1 },
      admin,
    );
    expect((orderResult["data"] as Record<string, unknown>)["status"]).toBe("shipped");
  });

  test("invalid transition on entity A still rejects (guard actually fires)", async () => {
    const invoice = await stack.http.writeOk<{ id: number }>(
      "txguard:write:invoice:create",
      { title: "Inv-2" },
      admin,
    );

    // draft → paid is NOT allowed (only draft → sent, sent → paid)
    const err = await stack.http.writeErr(
      "txguard:write:invoice:update",
      { id: invoice["id"], changes: { status: "paid" }, version: 1 },
      admin,
    );
    expectErrorIncludes(err, "Invalid transition");
    expectErrorIncludes(err, "draft");
    expectErrorIncludes(err, "paid");
  });

  test("invalid transition uses entity B's own map, not a leaked one", async () => {
    const order = await stack.http.writeOk<{ id: number }>(
      "txguard:write:order:create",
      { title: "Ord-2" },
      admin,
    );

    // open → delivered is NOT allowed (only open → shipped, shipped → delivered)
    const err = await stack.http.writeErr(
      "txguard:write:order:update",
      { id: order["id"], changes: { status: "delivered" }, version: 1 },
      admin,
    );
    expectErrorIncludes(err, "Invalid transition");
    expectErrorIncludes(err, "open");
    expectErrorIncludes(err, "delivered");
  });

  test("soft-deleted rows bypass the guard (no state-machine enforcement on zombies)", async () => {
    const ticket = await stack.http.writeOk<{ id: number }>(
      "txguard:write:ticket:create",
      { title: "T-1" },
      admin,
    );

    // Raw-DB-mark-deleted — we need a soft-deleted row whose status is a
    // terminal state. If the guard fired, any status write would throw
    // "Invalid transition: closed → <x>". We want it silently skipped.
    const { eq } = await import("drizzle-orm");
    await stack.db.db
      .update(ticketTable)
      .set({ status: "closed", isDeleted: true })
      .where(eq(ticketTable["id"], ticket["id"]));

    // Attempting to move a deleted ticket to "open" would normally violate
    // "closed → []" (no allowed targets). With the softDelete skip, the
    // guard steps aside and the request only fails because CrudExecutor
    // filters deleted rows from updates — giving a `not_found`, not a
    // transition error. That distinction proves the guard skipped.
    const err = await stack.http.writeErr(
      "txguard:write:ticket:update",
      { id: ticket["id"], changes: { status: "open" }, version: 1 },
      admin,
    );
    // Guard was skipped → we don't see "Invalid transition", we see a different
    // failure (soft-deleted row is filtered out of the lookup, so "not_found").
    expect(JSON.stringify(err)).not.toContain("Invalid transition");
    expectErrorIncludes(err, "not_found");
  });

  test("concurrent writes on the same row serialize via SELECT FOR UPDATE", async () => {
    // Two parallel requests both trying to move the SAME invoice from draft.
    // One legal: draft → sent. One deliberately stale (would also be legal
    // draft → sent, but since we hold the row lock, the second caller sees
    // the updated state `sent` when its turn comes and must fail — either
    // via the transition guard (sent → sent is not defined) or version
    // conflict. Without the FOR UPDATE both could snapshot `draft` under
    // READ COMMITTED and race past the guard; the second UPDATE would then
    // fail only via the optimistic lock, losing the specific error signal.
    const invoice = await stack.http.writeOk<{ id: number }>(
      "txguard:write:invoice:create",
      { title: "Concurrent-1" },
      admin,
    );

    const [res1, res2] = await Promise.all([
      stack.http.write(
        "txguard:write:invoice:update",
        { id: invoice["id"], changes: { status: "sent" }, version: 1 },
        admin,
      ),
      stack.http.write(
        "txguard:write:invoice:update",
        { id: invoice["id"], changes: { status: "sent" }, version: 1 },
        admin,
      ),
    ]);

    const body1 = (await res1.json()) as { isSuccess: boolean; error?: unknown };
    const body2 = (await res2.json()) as { isSuccess: boolean; error?: unknown };

    // Exactly one of the two must win. If both succeeded, the row lock
    // didn't serialize — both wrote draft→sent using a stale snapshot.
    const successes = [body1, body2].filter((b) => b.isSuccess);
    const failures = [body1, body2].filter((b) => !b.isSuccess);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The loser saw state `sent` on its (now serialized) guard read and
    // rejected the transition — NOT a version_conflict, which would be the
    // optimistic-lock fallback if the guard had race-passed.
    // The loser's UnprocessableError carries reason "invalid_transition" plus
    // the from/to states for debugging.
    const loser = failures[0]?.error as { code: string; details: { reason: string; from: string } };
    expect(loser.code).toBe("unprocessable");
    expect(loser.details.reason).toBe("invalid_transition");
    expect(loser.details.from).toBe("sent");
  });
});
