import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";

const retryRuns: [number, boolean][] = [];
const singleRuns: [number, boolean][] = [];

const attemptFixtureFeature = defineFeature("attemptfixture", (r) => {
  r.writeHandler(
    "trigger-retry",
    z.object({}),
    async () => ({ isSuccess: true as const, data: {} }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
  r.job(
    "retry",
    { trigger: { on: "attemptfixture:write:trigger-retry" }, retries: 2 },
    async (_payload, ctx) => {
      retryRuns.push([ctx.attempt, ctx.finalAttempt]);
      if (ctx.attempt < 3) throw new Error(`fails on attempt ${ctx.attempt}`);
    },
  );

  r.writeHandler(
    "trigger-single",
    z.object({}),
    async () => ({ isSuccess: true as const, data: {} }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
  r.job(
    "single",
    { trigger: { on: "attemptfixture:write:trigger-single" } },
    async (_payload, ctx) => {
      singleRuns.push([ctx.attempt, ctx.finalAttempt]);
    },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [attemptFixtureFeature],
    jobs: { consumerLane: "worker" },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  retryRuns.length = 0;
  singleRuns.length = 0;
});

describe("JobContext.attempt / finalAttempt", () => {
  test("increments per retry and marks the last configured attempt final", async () => {
    await stack.http.writeOk("attemptfixture:write:trigger-retry", {}, TestUsers.admin);

    await stack.drainJobs();
    expect(retryRuns).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
  });

  test("a job without retries starts at attempt 1 and is already final", async () => {
    await stack.http.writeOk("attemptfixture:write:trigger-single", {}, TestUsers.admin);

    await stack.drainJobs();
    expect(singleRuns).toEqual([[1, true]]);
  });
});
