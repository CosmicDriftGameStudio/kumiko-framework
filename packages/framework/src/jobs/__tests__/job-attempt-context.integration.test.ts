import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import * as z from "zod";
import { createRegistry, defineFeature } from "../../engine/index.js";
import { createDistributedLock } from "../../pipeline/distributed-lock.js";
import { RedisKeys } from "../../pipeline/redis-keys.js";
import {
  createTestRedis,
  setupTestStack,
  type TestRedis,
  type TestStack,
  TestUsers,
} from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";
import { createJobRunner } from "../job-runner.js";

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

describe("JobContext.attempt / finalAttempt through the runner's other entry points", () => {
  let testRedis: TestRedis;
  let redisUrl: string;

  beforeAll(async () => {
    testRedis = await createTestRedis();
    redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
  });

  afterAll(async () => {
    await testRedis.cleanup();
  });

  function uniquePrefix(tag: string): string {
    return `kumiko-test-attempt-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function purgeWorkerKeys(queueNamePrefix: string): Promise<void> {
    const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
    if (keys.length > 0) await testRedis.redis.del(...keys);
  }

  test("a sequential retry that hits a busy lock keeps counting instead of restarting at 1", async () => {
    const runs: [number, boolean][] = [];
    const feature = defineFeature("attemptseq", (r) => {
      r.job(
        "flaky",
        {
          trigger: { manual: true },
          concurrency: "sequential",
          retries: 1,
          backoff: { type: "fixed", delayMs: 800 },
        },
        async (_payload, ctx) => {
          runs.push([ctx.attempt, ctx.finalAttempt]);
          throw new Error("always fails");
        },
      );
    });
    const jobName = "attemptseq:job:flaky";
    const queueNamePrefix = uniquePrefix("seq");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {},
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });
    const rawQueue = new Queue(`${queueNamePrefix}-worker`, {
      connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
    });
    rawQueue.on("error", () => {});
    const lockRedis = new Redis(redisUrl);
    const lock = createDistributedLock(
      lockRedis,
      `${RedisKeys.lock}seq:${queueNamePrefix}:worker:`,
    );
    let heldToken: string | null = null;

    try {
      await runner.start();
      await runner.dispatch(jobName, {});
      await waitFor(() => runs.length >= 1);

      // Held before the retry's backoff elapses, so the retry attempt collides with it.
      await waitFor(async () => {
        heldToken = await lock.acquire(jobName, { ttlSeconds: 30 });
        return heldToken !== null;
      });
      await waitFor(
        async () => {
          const delayed = await rawQueue.getDelayed();
          return delayed.some((j) => j.name === jobName && j.data?._priorAttempts === 1);
        },
        { delays: [200, 400, 800, 1600] },
      );

      if (heldToken) await lock.release(jobName, heldToken);
      await waitFor(() => runs.length >= 2);
      expect(runs).toEqual([
        [1, false],
        [2, true],
      ]);
    } finally {
      await rawQueue.close();
      await runner.stop();
      lockRedis.disconnect();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("a boot gate runs inline as attempt 1 and is already final", async () => {
    const runs: [number, boolean][] = [];
    const feature = defineFeature("attemptgate", (r) => {
      r.job(
        "check",
        { trigger: { manual: true }, bootGate: true, retries: 2 },
        async (_payload, ctx) => {
          runs.push([ctx.attempt, ctx.finalAttempt]);
        },
      );
    });
    const queueNamePrefix = uniquePrefix("gate");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {},
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });
    try {
      await runner.start();
      expect(runs).toEqual([[1, true]]);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});
