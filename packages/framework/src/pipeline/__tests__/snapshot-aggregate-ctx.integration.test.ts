// ctx.events.snapshot + ctx.events.loadWithSnapshot over HTTP: the
// snapshot short-circuits the replay, later events are folded on top, and
// the stored snapshot never leaks across tenants.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { append, loadAggregate as loadAggregateRaw } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const AGGREGATE_TYPE = "snap-counter";

const tickedPayload = z.object({ amountCents: z.number().int() });

const counterStateSchema = z.object({ totalCents: z.number().int(), ticks: z.number().int() });
type CounterState = z.infer<typeof counterStateSchema>;

const INITIAL_STATE: CounterState = { totalCents: 0, ticks: 0 };

function foldTick(state: CounterState, payload: unknown): CounterState {
  const { amountCents } = tickedPayload.parse(payload);
  return { totalCents: state.totalCents + amountCents, ticks: state.ticks + 1 };
}

const snapshotFeature = defineFeature("snaptest", (r) => {
  const ticked = r.defineEvent("ticked", tickedPayload, {
    piiFields: "none",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        transform: (payload) => {
          const { amount } = z.object({ amount: z.string() }).parse(payload);
          return { amountCents: Math.round(Number.parseFloat(amount) * 100) };
        },
      },
    ],
  });

  r.writeHandler({
    name: "counter:tick",
    schema: z.object({ id: z.uuid(), amountCents: z.number().int() }),
    handler: async (event, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: event.payload.id,
        aggregateType: AGGREGATE_TYPE,
        type: ticked.name,
        payload: { amountCents: event.payload.amountCents },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "counter:snapshot",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) => {
      const events = await ctx.events.load(event.payload.id);
      const lastEvent = events.at(-1);
      if (!lastEvent) throw new Error("nothing to snapshot");
      const state = events.reduce((acc, evt) => foldTick(acc, evt.payload), INITIAL_STATE);
      await ctx.events.snapshot({
        aggregateId: event.payload.id,
        aggregateType: AGGREGATE_TYPE,
        version: lastEvent.version,
        state,
      });
      return { isSuccess: true as const, data: { version: lastEvent.version } };
    },
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "counter:state",
    schema: z.object({ id: z.uuid() }),
    handler: async (query, ctx) =>
      ctx.events.loadWithSnapshot<CounterState>(
        query.payload.id,
        (state, evt) => foldTick(state, evt.payload),
        INITIAL_STATE,
      ),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

type StateResult = { state: CounterState; version: number; snapshotHit: boolean };

let stack: TestStack;
const admin = TestUsers.admin;
const otherTenantAdmin = TestUsers.otherTenant;
const counterId = "00000000-0000-4000-8000-0000000000c1";

beforeAll(async () => {
  stack = await setupTestStack({ features: [snapshotFeature], systemHooks: [] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack);
});

async function tick(amountCents: number): Promise<void> {
  await stack.http.writeOk("snaptest:write:counter:tick", { id: counterId, amountCents }, admin);
}

function queryState(user: typeof admin | typeof otherTenantAdmin): Promise<StateResult> {
  return stack.http.queryOk<StateResult>("snaptest:query:counter:state", { id: counterId }, user);
}

describe("ctx.events.snapshot + ctx.events.loadWithSnapshot", () => {
  test("starts from the snapshot and folds later events on top", async () => {
    await tick(100);
    await tick(250);

    const beforeSnapshot = await queryState(admin);
    expect(beforeSnapshot.snapshotHit).toBe(false);
    expect(beforeSnapshot.state).toEqual({ totalCents: 350, ticks: 2 });

    const snapshotted = await stack.http.writeOk<{ version: number }>(
      "snaptest:write:counter:snapshot",
      { id: counterId },
      admin,
    );
    expect(snapshotted.version).toBe(2);

    await tick(50);

    const afterSnapshot = await queryState(admin);
    expect(afterSnapshot.snapshotHit).toBe(true);
    expect(afterSnapshot.version).toBe(3);
    expect(afterSnapshot.state).toEqual({ totalCents: 400, ticks: 3 });
  });

  test("a v1 event appended after the snapshot reaches the reducer upcasted", async () => {
    await tick(100);
    await stack.http.writeOk("snaptest:write:counter:snapshot", { id: counterId }, admin);

    const existing = await loadAggregateRaw(stack.db, counterId, admin.tenantId);
    await append(stack.db, {
      aggregateId: counterId,
      aggregateType: AGGREGATE_TYPE,
      tenantId: admin.tenantId,
      expectedVersion: existing.length,
      type: "snaptest:event:ticked",
      eventVersion: 1,
      payload: { amount: "2.50" },
      metadata: { userId: admin.id },
    });

    const result = await queryState(admin);
    expect(result.snapshotHit).toBe(true);
    expect(result.state).toEqual({ totalCents: 350, ticks: 2 });
  });

  test("another tenant does not see the snapshot or state of the first tenant", async () => {
    await tick(100);
    await stack.http.writeOk("snaptest:write:counter:snapshot", { id: counterId }, admin);

    const own = await queryState(admin);
    expect(own.snapshotHit).toBe(true);

    const foreign = await queryState(otherTenantAdmin);
    expect(foreign.snapshotHit).toBe(false);
    expect(foreign.version).toBe(0);
    expect(foreign.state).toEqual(INITIAL_STATE);
  });
});
