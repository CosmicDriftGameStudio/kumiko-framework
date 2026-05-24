// Runde 3 / C.2a — ctx.fetchForWriting (Marten FetchForWriting equivalent).
//
// Claims pinned here:
//   1. Returns the current stream (upcasted) + its version.
//   2. expectedVersion mismatch throws VersionConflictError BEFORE any write.
//   3. appendOne reuses the handle's aggregateId/aggregateType + inherits
//      the stream version internally — a sequence of appendOne calls writes
//      consecutive versions without re-reading the DB.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { asRawClient } from "../../db/query-api";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { UnprocessableError, writeFailure } from "../../errors";
import { loadAggregate } from "../../event-store";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { setupTestStack, type TestStack } from "../../stack";

// --- Feature ---

const cartEntity = createEntity({
  table: "read_f4w_carts",
  fields: {
    customer: createTextField({ required: true }),
  },
});

const cartTable = buildEntityTable("f4wCart", cartEntity);

const cartFeature = defineFeature("f4w", (r) => {
  r.entity("f4wCart", cartEntity);

  const itemAdded = r.defineEvent("itemAdded", z.object({ sku: z.string(), qty: z.number() }));
  const checkedOut = r.defineEvent("checkedOut", z.object({ totalCents: z.number() }));

  const cartExecutor = createEventStoreExecutor(cartTable, cartEntity, {
    entityName: "f4wCart",
  });

  // Root: create a cart.
  r.writeHandler(
    "cart:create",
    z.object({ customer: z.string() }),
    async (event, ctx) => cartExecutor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  // Fetch handle, inspect events, append one atom.
  r.writeHandler(
    "cart:add-item",
    z.object({ id: z.uuid(), sku: z.string(), qty: z.number() }),
    async (event, ctx) => {
      const stream = await ctx.fetchForWriting({
        aggregateId: event.payload.id,
        aggregateType: "f4wCart",
      });
      // Business rule probe: if already checked out, refuse.
      const alreadyDone = stream.events.some((e) => e.type === checkedOut.name);
      if (alreadyDone) {
        return writeFailure(new UnprocessableError("already_checked_out"));
      }
      await stream.appendOne({
        type: itemAdded.name,
        payload: { sku: event.payload.sku, qty: event.payload.qty },
      });
      return { isSuccess: true as const, data: { version: stream.version } };
    },
    { access: { roles: ["Admin"] } },
  );

  // Fetch + multi-append in one handler (proves local version bumping).
  r.writeHandler(
    "cart:bulk-add",
    z.object({ id: z.uuid(), skus: z.array(z.string()) }),
    async (event, ctx) => {
      const stream = await ctx.fetchForWriting({
        aggregateId: event.payload.id,
        aggregateType: "f4wCart",
      });
      for (const sku of event.payload.skus) {
        await stream.appendOne({ type: itemAdded.name, payload: { sku, qty: 1 } });
      }
      return { isSuccess: true as const, data: { finalVersion: stream.version } };
    },
    { access: { roles: ["Admin"] } },
  );

  // Drives the cart to checked-out state — lets the add-item handler's
  // business-rule branch be exercised in a test.
  r.writeHandler(
    "cart:checkout",
    z.object({ id: z.uuid(), totalCents: z.number() }),
    async (event, ctx) => {
      const stream = await ctx.fetchForWriting({
        aggregateId: event.payload.id,
        aggregateType: "f4wCart",
      });
      await stream.appendOne({
        type: checkedOut.name,
        payload: { totalCents: event.payload.totalCents },
      });
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: ["Admin"] } },
  );

  // Fetch with expectedVersion — OCC gate for external callers.
  r.writeHandler(
    "cart:add-with-occ",
    z.object({
      id: z.uuid(),
      expectedVersion: z.number(),
      sku: z.string(),
    }),
    async (event, ctx) => {
      const stream = await ctx.fetchForWriting({
        aggregateId: event.payload.id,
        aggregateType: "f4wCart",
        expectedVersion: event.payload.expectedVersion,
      });
      await stream.appendOne({
        type: itemAdded.name,
        payload: { sku: event.payload.sku, qty: 1 },
      });
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: ["Admin"] } },
  );
});

// --- Stack ---

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [cartFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, cartEntity, "f4wCart");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_f4w_carts, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

// --- Tests ---

describe("Runde 3 / C.2a — ctx.fetchForWriting", () => {
  test("returns current stream + version; appendOne advances the stream", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "f4w:write:cart:create",
      { customer: "alice" },
      admin,
    );

    const result = await stack.http.writeOk<{ version: number }>(
      "f4w:write:cart:add-item",
      { id: created.id, sku: "apple", qty: 3 },
      admin,
    );
    // CRUD create = v1, appendOne = v2.
    expect(result.version).toBe(2);

    const events = await loadAggregate(stack.db, created.id, admin.tenantId);
    expect(events.map((e) => e.type)).toEqual(["f4wCart.created", "f4w:event:item-added"]);
  });

  test("multi-appendOne in one handler writes consecutive versions without re-reading", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "f4w:write:cart:create",
      { customer: "bob" },
      admin,
    );

    const result = await stack.http.writeOk<{ finalVersion: number }>(
      "f4w:write:cart:bulk-add",
      { id: created.id, skus: ["a", "b", "c"] },
      admin,
    );
    // CRUD = v1, then three appendOne = v2, v3, v4. Handle reports v4.
    expect(result.finalVersion).toBe(4);

    const events = await loadAggregate(stack.db, created.id, admin.tenantId);
    expect(events.map((e) => e.version)).toEqual([1, 2, 3, 4]);
  });

  test("expectedVersion mismatch throws VersionConflictError before any write lands", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "f4w:write:cart:create",
      { customer: "carol" },
      admin,
    );

    // Stream is at v1 (the create event). Caller thinks it's at v0 → conflict.
    const res = await stack.http.write(
      "f4w:write:cart:add-with-occ",
      { id: created.id, expectedVersion: 0, sku: "pear" },
      admin,
    );
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("version_conflict");

    // Stream untouched — only the original create event is present.
    const events = await loadAggregate(stack.db, created.id, admin.tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("f4wCart.created");
  });

  test("expectedVersion match lets the append proceed", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "f4w:write:cart:create",
      { customer: "dave" },
      admin,
    );

    const res = await stack.http.write(
      "f4w:write:cart:add-with-occ",
      { id: created.id, expectedVersion: 1, sku: "peach" },
      admin,
    );
    expect(res.status).toBe(200);

    const events = await loadAggregate(stack.db, created.id, admin.tenantId);
    expect(events).toHaveLength(2);
  });

  test("handle.events reflects business state — happy path keeps working", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "f4w:write:cart:create",
      { customer: "eve" },
      admin,
    );
    // First add — no checked-out yet, rule-probe passes.
    const first = await stack.http.write(
      "f4w:write:cart:add-item",
      { id: created.id, sku: "plum", qty: 1 },
      admin,
    );
    expect(first.status).toBe(200);
  });

  test("business-rule probe on handle.events: after checkout, add-item refuses", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      "f4w:write:cart:create",
      { customer: "frank" },
      admin,
    );

    // Checkout lands a `checkedOut` event on the stream.
    const checkoutRes = await stack.http.write(
      "f4w:write:cart:checkout",
      { id: created.id, totalCents: 4200 },
      admin,
    );
    expect(checkoutRes.status).toBe(200);

    // Now add-item should observe checkedOut via stream.events and refuse.
    const res = await stack.http.write(
      "f4w:write:cart:add-item",
      { id: created.id, sku: "late-banana", qty: 1 },
      admin,
    );
    const body = (await res.json()) as { isSuccess: boolean; error?: { code?: string } };
    expect(body.isSuccess).toBe(false);
    expect(body.error?.code).toBe("unprocessable");

    // Stream untouched by the refused add — only create + checkedOut remain.
    const events = await loadAggregate(stack.db, created.id, admin.tenantId);
    const types = events.map((e) => e.type);
    expect(types).toContain("f4wCart.created");
    expect(types).toContain("f4w:event:checked-out");
    expect(types).not.toContain("f4w:event:item-added");
  });
});
