// Review round 2 regressions for the job runner, each over a real BullMQ
// worker and real Redis.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { requestContext } from "../../api/request-context.js";
import { createRegistry, defineFeature } from "../../engine/index.js";
import type { AppContext } from "../../engine/types/index.js";
import { createPrometheusMeter } from "../../observability/index.js";
import { createDistributedLock } from "../../pipeline/distributed-lock.js";
import { RedisKeys } from "../../pipeline/redis-keys.js";
import { createTestDb, createTestRedis, type TestDb, type TestRedis } from "../../stack/index.js";
import { sleep, waitFor } from "../../testing/index.js";
import { createJobRunner, type JobOutcomeMeta } from "../job-runner.js";

let testRedis: TestRedis;
let testDb: TestDb;
let redisUrl: string;

beforeAll(async () => {
  testRedis = await createTestRedis();
  testDb = await createTestDb();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

function uniquePrefix(tag: string): string {
  return `kumiko-test-r2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function purgeWorkerKeys(queueNamePrefix: string): Promise<void> {
  const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
  if (keys.length > 0) await testRedis.redis.del(...keys);
}

describe("job runner without a db connection", () => {
  test("a run fails with a diagnosable error instead of a bare TypeError", async () => {
    let handlerRan = false;
    const failures: string[] = [];
    const feature = defineFeature("nodbjob", (r) => {
      r.job("needsDb", { trigger: { manual: true } }, async (_payload, ctx) => {
        handlerRan = true;
        void ctx.db.unsafeRaw;
      });
    });
    const queueNamePrefix = uniquePrefix("nodb");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {},
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobFailed: (_name, _id, error) => {
        failures.push(error);
      },
    });
    await runner.start();
    try {
      await runner.dispatch("nodbjob:job:needs-db", {});
      await waitFor(() => failures.length > 0);
      expect(failures[0]).toContain("without a db connection");
      expect(failures[0]).toContain("nodbjob:job:needs-db");
      expect(handlerRan).toBe(true);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});

describe("job-last-success metric", () => {
  test("a meter nobody registered standard metrics on does not turn a success into a failure", async () => {
    const failures: string[] = [];
    const feature = defineFeature("unregmeter", (r) => {
      r.job("ok", { trigger: { manual: true } }, async () => {});
    });
    const meter = createPrometheusMeter();
    const queueNamePrefix = uniquePrefix("meter");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: { meter } satisfies AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobFailed: (name) => {
        failures.push(name);
      },
    });
    await runner.start();
    try {
      await runner.dispatch("unregmeter:job:ok", {});
      await waitFor(() =>
        meter
          .snapshot()
          .get("kumiko_job_last_success_timestamp_seconds")
          ?.slots.some((s) => s.labels?.["job"] === "unregmeter:job:ok"),
      );
      expect(failures).toEqual([]);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});

describe("tenantVisibleFailure subject config error", () => {
  test("a non-primitive subject field fails the run visibly and is not retried", async () => {
    let handlerCalls = 0;
    const started: string[] = [];
    const failed: Array<{ error: string; outcome: JobOutcomeMeta | undefined }> = [];
    const feature = defineFeature("subjectcfg", (r) => {
      r.job(
        "tracked",
        {
          trigger: { manual: true },
          retries: 2,
          tenantVisibleFailure: { messageKey: "app:errors.failed", subjectFields: ["docId"] },
        },
        async () => {
          handlerCalls += 1;
        },
      );
    });
    const queueNamePrefix = uniquePrefix("subject");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: { db: testDb.db },
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobStart: (name) => {
        started.push(name);
      },
      onJobFailed: (_name, _id, error, _logs, outcome) => {
        failed.push({ error, outcome });
      },
    });
    await runner.start();
    try {
      await runner.dispatch("subjectcfg:job:tracked", { docId: { nested: true } });
      await waitFor(() => failed.length > 0);
      await sleep(500);
      expect(started).toEqual(["subjectcfg:job:tracked"]);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.error).toContain('subjectFields["docId"] must be a primitive');
      expect(failed[0]?.outcome?.tenantVisible).toBeUndefined();
      expect(handlerCalls).toBe(0);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});

describe("event attribution of job runs", () => {
  test("a job stamps the feature's raw name, same as write-handlers do", async () => {
    const seen: Array<string | undefined> = [];
    const feature = defineFeature("pubSubOrders", (r) => {
      r.job("stamp", { trigger: { manual: true } }, async () => {
        seen.push(requestContext.get()?.feature);
      });
    });
    const registry = createRegistry([feature]);
    const queueNamePrefix = uniquePrefix("stamp");
    const runner = createJobRunner({
      registry,
      context: { db: testDb.db },
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });
    await runner.start();
    try {
      await runner.dispatch("pub-sub-orders:job:stamp", {});
      await waitFor(() => seen.length > 0);
      expect(seen[0]).toBe("pubSubOrders");
      expect(seen[0]).toBe(registry.getJobFeature("pub-sub-orders:job:stamp"));
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});

describe("sequential lock conflict on a retry attempt", () => {
  test("does not hand out a fresh retry budget", async () => {
    const jobName = "priorattempts:job:flaky";
    let handlerCalls = 0;
    const finalFlags: Array<boolean | undefined> = [];
    const feature = defineFeature("priorattempts", (r) => {
      r.job(
        "flaky",
        {
          trigger: { manual: true },
          concurrency: "sequential",
          retries: 1,
          backoff: { type: "fixed", delayMs: 800 },
        },
        async () => {
          handlerCalls += 1;
          throw new Error("always fails");
        },
      );
    });
    const queueNamePrefix = uniquePrefix("prior");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: { db: testDb.db },
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobFailed: (_name, _id, _error, _logs, outcome) => {
        finalFlags.push(outcome?.finalAttempt);
      },
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
      await waitFor(() => finalFlags.length >= 1);
      expect(finalFlags[0]).toBe(false);

      // Take the lock before the retry's backoff elapses so the retry attempt
      // collides with it.
      await waitFor(async () => {
        heldToken = await lock.acquire(jobName, { ttlSeconds: 30 });
        return heldToken !== null;
      });

      let reenqueuedAttempts: number | undefined;
      await waitFor(
        async () => {
          const delayed = await rawQueue.getDelayed();
          const carried = delayed.find((j) => j.name === jobName && j.data?._priorAttempts === 1);
          reenqueuedAttempts = carried?.opts.attempts;
          return carried !== undefined;
        },
        { delays: [200, 400, 800, 1600] },
      );
      expect(reenqueuedAttempts).toBe(1);

      if (heldToken) await lock.release(jobName, heldToken);
      await waitFor(() => finalFlags.length >= 2);
      expect(finalFlags[1]).toBe(true);

      await sleep(800);
      expect(handlerCalls).toBe(2);
    } finally {
      await rawQueue.close();
      await runner.stop();
      lockRedis.disconnect();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});
