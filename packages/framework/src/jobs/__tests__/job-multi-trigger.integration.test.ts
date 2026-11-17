// Runtime test for r.job multi-trigger:
// proves that a job with an array trigger fires for ALL declared triggers
// and that payload._triggerName contains the correct name.
//
// Unit tests in engine.test.ts cover only boot behavior (acceptance +
// validator rejection). This test exercises the runtime-dispatch paths
// through a real BullMQ worker.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const jobExecutions: Array<{ trigger: string; payload: Record<string, unknown> }> = [];

// Feature with two write handlers, each appending its own event, and one job
// that listens to both events. One job body with multiple triggers is the DRY
// case addressed by r.job multi-trigger.
const orderFeature = defineFeature("multi", (r) => {
  r.defineEvent("order-opened", z.object({ id: z.string() }), { piiFields: "none" });
  r.defineEvent("order-cancelled", z.object({ id: z.string() }), { piiFields: "none" });
  r.writeHandler({
    name: "order:open",
    schema: z.object({ id: z.string() }),
    handler: async (event, ctx) => {
      await ctx.events.append({
        aggregateId: crypto.randomUUID(),
        aggregateType: "order",
        type: "multi:event:order-opened",
        payload: { id: event.payload.id },
      });
      return { isSuccess: true, data: { id: event.payload.id } };
    },
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.writeHandler({
    name: "order:cancel",
    schema: z.object({ id: z.string() }),
    handler: async (event, ctx) => {
      await ctx.events.append({
        aggregateId: crypto.randomUUID(),
        aggregateType: "order",
        type: "multi:event:order-cancelled",
        payload: { id: event.payload.id },
      });
      return { isSuccess: true, data: { id: event.payload.id } };
    },
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.job(
    "fanout",
    {
      trigger: {
        on: ["multi:event:order-opened", "multi:event:order-cancelled"],
      },
    },
    async (payload, ctx) => {
      // ctx.triggerName is the idiomatic API: for multi-trigger jobs,
      // this field tells the handler which of the N triggers fired.
      jobExecutions.push({ trigger: ctx.triggerName ?? "<missing>", payload });
    },
  );
});

let stack: TestStack;

const adminUser = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [orderFeature],
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("r.job multi-trigger — runtime-dispatch", () => {
  test("Trigger 1 (order-opened) → Job runs with ctx.triggerName=multi:event:order-opened", async () => {
    jobExecutions.length = 0;

    await stack.http.writeOk("multi:write:order:open", { id: "o-1" }, adminUser);
    await stack.drainJobs();

    const exec = jobExecutions[0];
    expect(exec).toBeDefined();
    expect(exec?.trigger).toBe("multi:event:order-opened");
    expect(exec?.payload["id"]).toBe("o-1");
  });

  test("Trigger 2 (order-cancelled) → the same job runs with ctx.triggerName=multi:event:order-cancelled", async () => {
    jobExecutions.length = 0;

    await stack.http.writeOk("multi:write:order:cancel", { id: "o-2" }, adminUser);
    await stack.drainJobs();

    const exec = jobExecutions[0];
    expect(exec).toBeDefined();
    expect(exec?.trigger).toBe("multi:event:order-cancelled");
    expect(exec?.payload["id"]).toBe("o-2");
  });

  test("Both triggers in sequence → 2 job runs, each with the correct ctx.triggerName", async () => {
    jobExecutions.length = 0;

    await stack.http.writeOk("multi:write:order:open", { id: "a" }, adminUser);
    await stack.http.writeOk("multi:write:order:cancel", { id: "b" }, adminUser);
    await stack.drainJobs();

    expect(jobExecutions.length).toBe(2);
    const triggers = jobExecutions.map((e) => e.trigger).sort();
    expect(triggers).toEqual(["multi:event:order-cancelled", "multi:event:order-opened"]);
  });
});
