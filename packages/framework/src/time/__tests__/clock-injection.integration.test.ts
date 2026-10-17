// extraContext.clock reaches ctx.tz in handlers (over HTTP) and in jobs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createManualClock } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { TestUsers } from "../../seeding/seed-users.js";

const clock = createManualClock(Temporal.Instant.from("2031-02-03T04:05:06Z"));
const jobSeenNow: string[] = [];

const clockFeature = defineFeature("clockprobe", (r) => {
  r.writeHandler({
    name: "read-now",
    schema: z.object({}),
    handler: async (_event, ctx) => ({
      isSuccess: true as const,
      data: { now: ctx.tz.now().toString(), today: ctx.tz.today("UTC").toString() },
    }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.job("record-now", { trigger: { manual: true }, runIn: "worker" }, async (_payload, ctx) => {
    jobSeenNow.push(ctx.tz.now().toString());
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [clockFeature],
    extraContext: { clock },
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("AppContext.clock", () => {
  test("a handler's ctx.tz.now returns the injected time over HTTP", async () => {
    const first = await stack.http.writeOk<{ now: string; today: string }>(
      "clockprobe:write:read-now",
      {},
      TestUsers.admin,
    );
    expect(first).toEqual({ now: "2031-02-03T04:05:06Z", today: "2031-02-03" });

    clock.advance({ hours: 24 });
    const second = await stack.http.writeOk<{ now: string }>(
      "clockprobe:write:read-now",
      {},
      TestUsers.admin,
    );
    expect(second.now).toBe("2031-02-04T04:05:06Z");
  });

  test("a job's ctx.tz.now returns the injected time", async () => {
    clock.set(Temporal.Instant.from("2040-01-01T00:00:00Z"));

    await stack.jobRunner?.dispatch("clockprobe:job:record-now", {});
    await stack.drainJobs();

    expect(jobSeenNow).toEqual(["2040-01-01T00:00:00Z"]);
  });
});
