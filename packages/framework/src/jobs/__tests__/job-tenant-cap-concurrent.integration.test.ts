import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestRedis,
  type TestRedis,
  testRunQueueNamePrefix,
} from "@cosmicdrift/kumiko-testing/stack";
import { Queue, Worker } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { createJobRunner } from "../job-runner.ts";
import { isOverPerTenantLimit } from "../job-runner-scope.ts";
import { purgeRawRedisKeys } from "./purge-raw-redis-keys.ts";
import { createReleaseGate } from "./release-gate.ts";

const CAP = 2;
const SKIPPED = "skipped:max-per-tenant";

let testRedis: TestRedis;
let redisUrl: string;

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

describe("maxPerTenant skip cap under concurrent dispatch", () => {
  test("simultaneous dispatches from api and worker runners admit exactly the cap", async () => {
    const gate = createReleaseGate();
    gate.hold();
    const feature = defineFeature("capburst", (r) => {
      r.job({
        name: "limited",
        trigger: { manual: true },
        maxPerTenant: CAP,
        handler: async () => {
          await gate.wait();
        },
      });
    });
    const queueNamePrefix = testRunQueueNamePrefix("kumiko-test-capburst");
    const options = {
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      queueNamePrefix,
    };
    const workerRunner = createJobRunner({ ...options, consumerLane: "worker" });
    const apiRunner = createJobRunner({ ...options, consumerLane: "api" });
    try {
      await workerRunner.start();
      await apiRunner.start();
      const dispatches = Array.from({ length: 12 }, (_, n) =>
        (n % 2 === 0 ? workerRunner : apiRunner).dispatch("capburst:job:limited", {
          n,
          _tenantId: "tenant-burst",
        }),
      );
      const ids = await Promise.all(dispatches);
      expect(ids.filter((id) => id !== SKIPPED)).toHaveLength(CAP);
    } finally {
      gate.release();
      await apiRunner.stop();
      await workerRunner.stop();
      await purgeRawRedisKeys(redisUrl, `bull:${queueNamePrefix}-*:*`);
    }
  });
});

describe("maxPerTenant defer order in Redis", () => {
  // Activation order deliberately runs against id order: the job with the larger id
  // string becomes active first, as with event ids of different digit counts.
  test("only jobs activated earlier count, whatever their ids and timestamps", async () => {
    const queueNamePrefix = testRunQueueNamePrefix("kumiko-test-deferorder");
    const connection = {
      host: testRedis.redis.options.host,
      port: testRedis.redis.options.port,
      db: testRedis.redis.options.db,
    };
    const jobName = "deferorder:job:parse";
    const tenantId = "tenant-order";
    const queues = {
      api: new Queue(`${queueNamePrefix}-api`, { connection }),
      worker: new Queue(`${queueNamePrefix}-worker`, { connection }),
    };
    const manualWorker = new Worker(`${queueNamePrefix}-worker`, null, { connection });
    queues.api.on("error", () => {});
    queues.worker.on("error", () => {});
    manualWorker.on("error", () => {});
    const token = "defer-order-token";
    try {
      const activationOrder = ["event.parse.24", "event.parse.16", "event.parse.100"];
      for (const jobId of activationOrder) {
        await queues.worker.add(jobName, { _tenantId: tenantId }, { jobId });
      }
      const activated: string[] = [];
      for (const _ of activationOrder) {
        const job = await manualWorker.getNextJob(token, { block: false });
        if (job?.id !== undefined) activated.push(job.id);
      }
      expect(activated).toEqual(activationOrder);

      const defersAt = (jobId: string, limit: number) =>
        isOverPerTenantLimit({ queues }, jobName, tenantId, limit, {
          activatedBefore: { jobId },
        });
      expect(await Promise.all(activated.map((jobId) => defersAt(jobId, 1)))).toEqual([
        false,
        true,
        true,
      ]);
      expect(await Promise.all(activated.map((jobId) => defersAt(jobId, 2)))).toEqual([
        false,
        false,
        true,
      ]);
    } finally {
      await manualWorker.close();
      await queues.api.close();
      await queues.worker.close();
      await purgeRawRedisKeys(redisUrl, `bull:${queueNamePrefix}-*:*`);
    }
  });
});
