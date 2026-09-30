// fw#3360: stack.drainJobs() waits deterministically for every in-flight
// job AND its follow-up event-consumer / job-trigger cascade — replaces
// `waitFor` polling on a specific job's side effect.

import { afterEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { SYSTEM_ROLE } from "../../engine/system-user.js";
import { setupTestStack, type TestStack } from "../test-stack.js";
import { TestUsers } from "../test-users.js";

const chainResults: Array<{ value: string }> = [];

// Job A → write handler that appends an r.defineEvent event → the async
// job-trigger event-consumer → Job B. Exercises exactly the gap drainJobs
// exists for: a job-completion that only cascades into a follow-up job via
// the event-dispatcher, not the synchronous write-handler dispatch path.
const chainFeature = defineFeature("draintestchain", (r) => {
  const relayed = r.defineEvent("relayed", z.object({ value: z.string() }), {
    piiFields: "none",
  });

  r.writeHandler(
    "start",
    z.object({ value: z.string() }),
    async () => ({ isSuccess: true as const, data: {} }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );

  r.writeHandler(
    "emit-relayed",
    z.object({ value: z.string() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: crypto.randomUUID(),
        aggregateType: "draintestchain",
        type: relayed.name,
        payload: { value: event.payload.value },
      });
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: [SYSTEM_ROLE] } },
  );

  r.job(
    "job-a",
    { trigger: { on: "draintestchain:write:start" }, retries: 0 },
    async (payload, ctx) => {
      await ctx.write("draintestchain:write:emit-relayed", { value: payload["value"] });
    },
  );

  r.job("job-b", { trigger: { on: relayed.name }, retries: 0 }, async (payload) => {
    chainResults.push({ value: payload["value"] as string }); // @cast-boundary test-fixture
  });
});

const alwaysFailsRuns: string[] = [];
const retrySucceedsAttempts: number[] = [];

const failureFeature = defineFeature("draintestfailure", (r) => {
  r.job("always-fails", { trigger: { manual: true }, retries: 0 }, async () => {
    alwaysFailsRuns.push("ran");
    throw new Error("job-c always fails");
  });

  r.job(
    "retry-succeeds",
    { trigger: { manual: true }, retries: 1, backoff: { type: "fixed", delayMs: 10 } },
    async () => {
      retrySucceedsAttempts.push(Date.now());
      if (retrySucceedsAttempts.length === 1) throw new Error("first attempt fails on purpose");
    },
  );
});

let stack: TestStack | undefined;

afterEach(async () => {
  if (stack) await stack.cleanup();
  stack = undefined;
});

describe("stack.drainJobs() waits for a job's async event-trigger cascade", () => {
  test("job A → event → job B settles before drainJobs() resolves", async () => {
    chainResults.length = 0;
    stack = await setupTestStack({
      features: [chainFeature],
      jobs: { consumerLane: "worker" },
    });

    await stack.http.writeOk("draintestchain:write:start", { value: "hi" }, TestUsers.admin);
    await stack.drainJobs();

    expect(chainResults).toEqual([{ value: "hi" }]);
  });

  test("a huge event-dispatcher poll interval doesn't stop drainJobs() from driving the cascade itself", async () => {
    chainResults.length = 0;
    stack = await setupTestStack({
      features: [chainFeature],
      jobs: { consumerLane: "worker" },
    });
    // stop() tears down both the poll timer AND the LISTEN/NOTIFY
    // subscription (idempotent — cleanup()'s own stop() later is a no-op).
    // runOnce() still works afterward (event-dispatcher.ts's own contract),
    // so this leaves drainJobs() as the ONLY thing that can advance the
    // job-trigger consumer past job A's emitted event — without this, the
    // always-on pgClient wake-up races the assertion regardless of
    // eventDispatcherPollIntervalMs.
    await stack.eventDispatcher?.stop();

    await stack.http.writeOk("draintestchain:write:start", { value: "race" }, TestUsers.admin);
    await stack.drainJobs();

    expect(chainResults).toEqual([{ value: "race" }]);
  });
});

describe("stack.drainJobs() surfaces final job failures", () => {
  test("a job that always throws rejects drainJobs() with its name and error", async () => {
    alwaysFailsRuns.length = 0;
    stack = await setupTestStack({
      features: [failureFeature],
      jobs: { consumerLane: "worker" },
    });

    await stack.jobRunner?.dispatch("draintestfailure:job:always-fails");

    await expect(stack.drainJobs()).rejects.toThrow(
      /draintestfailure:job:always-fails.*job-c always fails/s,
    );

    // The tracker is cleared after a rejection — a later drainJobs() call
    // (e.g. the next test's setup) must not still see this failure.
    await expect(stack.drainJobs()).resolves.toBeUndefined();
  });

  test("a job with retries:1 that fails once then succeeds resolves drainJobs()", async () => {
    retrySucceedsAttempts.length = 0;
    stack = await setupTestStack({
      features: [failureFeature],
      jobs: { consumerLane: "worker" },
    });

    await stack.jobRunner?.dispatch("draintestfailure:job:retry-succeeds");

    await expect(stack.drainJobs()).resolves.toBeUndefined();
    expect(retrySucceedsAttempts).toHaveLength(2);
  });
});

describe("stack.drainJobs() without a jobRunner", () => {
  test("rejects with a clear message when the stack has no `jobs` opt-in", async () => {
    stack = await setupTestStack({ features: [chainFeature] });

    await expect(stack.drainJobs()).rejects.toThrow(/jobRunner is undefined/);
  });
});
