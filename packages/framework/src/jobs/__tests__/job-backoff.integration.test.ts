// fw#3167: buildRetryBullOpts only passed `{ type }` to BullMQ, never
// `delay` — BullMQ's fixed/exponential backoff strategies compute
// NaN/undefined without it (falsy), so a job with `backoff` set retried
// immediately instead of waiting. These tests assert real inter-attempt
// gaps via a real HTTP write that triggers the job through `trigger.on`,
// same delivery path as dispatch-write.ts's afterCommitHooks.
//
// Only lower bounds are asserted (never upper) — BullMQ schedules the next
// attempt at failureTime + delay using the same wall clock this test reads,
// so a >= assertion is flake-free without inflating waitFor's budget.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";
import { waitFor } from "../../testing";
import { generateId } from "../../utils";

const exponentialDefaultStarts: number[] = [];
const exponentialCustomStarts: number[] = [];
const fixedCustomStarts: number[] = [];

function gapsBetween(starts: readonly number[]): number[] {
  return starts.slice(1).map((start, index) => start - (starts[index] ?? start));
}

const backoffFixtureFeature = defineFeature("backofffixture", (r) => {
  r.writeHandler(
    "trigger-exponential-default",
    z.object({}),
    async () => ({ isSuccess: true as const, data: {} }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
  // AC: retries: 3, backoff: "exponential" — fails once, succeeds on retry 2.
  // Default base delay is 1000ms, so the single retry gap must be >= 1000ms.
  r.job(
    "exponential-default",
    {
      trigger: { on: "backofffixture:write:trigger-exponential-default" },
      retries: 3,
      backoff: "exponential",
    },
    async () => {
      exponentialDefaultStarts.push(Date.now());
      if (exponentialDefaultStarts.length === 1) throw new Error("fails on attempt 1");
    },
  );

  r.writeHandler(
    "trigger-exponential-custom",
    z.object({}),
    async () => ({ isSuccess: true as const, data: {} }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
  // Per-job configurable + growing: delayMs 50 → gaps 50, 100, 200ms.
  r.job(
    "exponential-custom",
    {
      trigger: { on: "backofffixture:write:trigger-exponential-custom" },
      retries: 3,
      backoff: { type: "exponential", delayMs: 50 },
    },
    async () => {
      exponentialCustomStarts.push(Date.now());
      if (exponentialCustomStarts.length < 4)
        throw new Error(`fails on attempt ${exponentialCustomStarts.length}`);
    },
  );

  r.writeHandler(
    "trigger-fixed-custom",
    z.object({}),
    async () => ({ isSuccess: true as const, data: {} }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
  r.job(
    "fixed-custom",
    {
      trigger: { on: "backofffixture:write:trigger-fixed-custom" },
      retries: 1,
      backoff: { type: "fixed", delayMs: 300 },
    },
    async () => {
      fixedCustomStarts.push(Date.now());
      if (fixedCustomStarts.length === 1) throw new Error("fails on attempt 1");
    },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [backoffFixtureFeature],
    // Own queue namespace: the default "kumiko-jobs" queue on the shared test
    // Redis is consumed by every parallel test process, and a foreign worker
    // grabbing a promoted delayed retry fails it as "Unknown job".
    jobs: { consumerLane: "worker", queueNamePrefix: `backoff-test-${generateId()}` },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  exponentialDefaultStarts.length = 0;
  exponentialCustomStarts.length = 0;
  fixedCustomStarts.length = 0;
});

describe("job backoff waits between retries (fw#3167)", () => {
  test('backoff: "exponential" without delayMs waits the default 1000ms base delay', async () => {
    await stack.http.writeOk(
      "backofffixture:write:trigger-exponential-default",
      {},
      TestUsers.admin,
    );

    await waitFor(() => {
      expect(exponentialDefaultStarts).toHaveLength(2);
    });

    const [gap = 0] = gapsBetween(exponentialDefaultStarts);
    expect(gap).toBeGreaterThanOrEqual(1000);
  });

  test("object-form backoff.delayMs is configurable per job and grows exponentially", async () => {
    await stack.http.writeOk(
      "backofffixture:write:trigger-exponential-custom",
      {},
      TestUsers.admin,
    );

    await waitFor(() => {
      expect(exponentialCustomStarts).toHaveLength(4);
    });

    const [gap1 = 0, gap2 = 0, gap3 = 0] = gapsBetween(exponentialCustomStarts);
    expect(gap1).toBeGreaterThanOrEqual(50);
    expect(gap2).toBeGreaterThanOrEqual(100);
    expect(gap3).toBeGreaterThanOrEqual(200);
  });

  test('backoff: { type: "fixed", delayMs } waits the configured constant delay', async () => {
    await stack.http.writeOk("backofffixture:write:trigger-fixed-custom", {}, TestUsers.admin);

    await waitFor(() => {
      expect(fixedCustomStarts).toHaveLength(2);
    });

    const [gap = 0] = gapsBetween(fixedCustomStarts);
    expect(gap).toBeGreaterThanOrEqual(300);
  });
});
