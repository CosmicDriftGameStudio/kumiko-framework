// Live multi-stream projection delivery walks stored events through the upcaster chain,
// and refuses events stored above the version this code knows.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { append } from "../../event-store/index.ts";
import { getConsumerState } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const NOTED_EVENT = "mspup:event:noted";
const CONSUMER_NAME = "mspup:projection:noted-log";

const observed: unknown[] = [];

const feature = defineFeature("mspup", (r) => {
  const noted = r.defineEvent("noted", z.object({ label: z.string(), source: z.string() }), {
    piiFields: "none",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        transform: (payload) => ({ ...z.object({ label: z.string() }).parse(payload), source: "upcast" }),
      },
    ],
  });
  r.multiStreamProjection({
    name: "noted-log",
    apply: {
      [noted.name]: async (event) => {
        observed.push(event.payload);
      },
    },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  observed.length = 0;
  await resetEventStore(stack);
});

describe("live MSP delivery and event versions", () => {
  test("live MSP delivery upcasts a v1 event before apply", async () => {
    await append(stack.db, {
      aggregateId: "00000000-0000-4000-8000-000000005001",
      aggregateType: "mspup-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: NOTED_EVENT,
      eventVersion: 1,
      payload: { label: "a" },
      metadata: { userId: String(admin.id) },
    });

    await stack.eventDispatcher?.runOnce();

    expect(observed).toEqual([{ label: "a", source: "upcast" }]);
  });

  test("live MSP delivery halts on an event above the known version", async () => {
    await append(stack.db, {
      aggregateId: "00000000-0000-4000-8000-000000005002",
      aggregateType: "mspup-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: NOTED_EVENT,
      eventVersion: 3,
      payload: { label: "b", source: "x" },
      metadata: { userId: String(admin.id) },
    });

    for (let i = 0; i < 15; i++) {
      await stack.eventDispatcher?.runOnce();
    }

    expect(observed).toEqual([]);
    const state = await getConsumerState(stack.db, CONSUMER_NAME);
    expect(state?.status).toBe("dead");
    expect(state?.lastError).toMatch(/eventVersion 3/);
  });
});
