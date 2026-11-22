// releaseCapUsage through the barrel, over real HTTP: a booking is given back and the counter never drops below 0.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { capCounterEntity } from "../entity.ts";
import { bookCapUsage, createCapCounterFeature, releaseCapUsage } from "../index.ts";
import { fetchCounterRow } from "./read-counter.ts";

const CAP_NAME = "release-cap";
const PERIOD = "2026-10-01T00:00:00Z";

const amountPayload = z.object({ amount: z.number().int().min(1) });

const bookHandler: WriteHandlerDef = {
  name: "book",
  schema: amountPayload,
  access: { roles: ["TenantAdmin"] },
  handler: (event, ctx) =>
    bookCapUsage(ctx, {
      capName: CAP_NAME,
      periodStartIso: PERIOD,
      amount: amountPayload.parse(event.payload).amount,
    }),
};

const releaseHandler: WriteHandlerDef = {
  name: "release",
  schema: amountPayload,
  access: { roles: ["TenantAdmin"] },
  handler: (event, ctx) =>
    releaseCapUsage(ctx, {
      capName: CAP_NAME,
      periodStartIso: PERIOD,
      amount: amountPayload.parse(event.payload).amount,
    }),
};

const probeFeature = defineFeature("releaseprobe", (r) => {
  r.writeHandler(bookHandler);
  r.writeHandler(releaseHandler);
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createCapCounterFeature(), probeFeature] });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const adminFor = (tenantNumber: number) =>
  createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });

describe("releaseCapUsage", () => {
  test("gives a booked amount back", async () => {
    const user = adminFor(7201);
    await stack.http.writeOk("releaseprobe:write:book", { amount: 5 }, user);
    await stack.http.writeOk("releaseprobe:write:release", { amount: 2 }, user);

    expect((await fetchCounterRow(stack, user, CAP_NAME, PERIOD))?.["value"]).toBe(3);
  });

  test("never drops the counter below 0", async () => {
    const user = adminFor(7202);
    await stack.http.writeOk("releaseprobe:write:book", { amount: 2 }, user);
    await stack.http.writeOk("releaseprobe:write:release", { amount: 9 }, user);

    expect((await fetchCounterRow(stack, user, CAP_NAME, PERIOD))?.["value"]).toBe(0);
  });
});
