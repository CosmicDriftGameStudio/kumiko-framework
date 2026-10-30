// A `{ maintenance: true }` job is one BullMQ job scheduler at the runner's maintenance window;
// restarting with another window replaces it instead of adding a second one.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { createJobRunner, schedulerIdForJobName } from "../job-runner.ts";
import type { MaintenanceWindow } from "../maintenance-window.ts";
import { purgeRawRedisKeys } from "./purge-raw-redis-keys.ts";

let testRedis: TestRedis;
let redisUrl: string;

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

const feature = defineFeature("tidy", (r) => {
  r.job("sweep", { trigger: { maintenance: true } }, async () => {});
});

function startRunner(queueNamePrefix: string, maintenanceWindow?: MaintenanceWindow) {
  return createJobRunner({
    registry: createRegistry([feature]),
    context: {} as AppContext,
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix,
    ...(maintenanceWindow !== undefined && { maintenanceWindow }),
  });
}

function nextUtc(hour: number, minute: number, after: number): number {
  const candidate = new Date(after);
  candidate.setUTCHours(hour, minute, 0, 0);
  if (candidate.getTime() <= after) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate.getTime();
}

// BullMQ derives the delay from its own clock a few ms after the scheduler upsert, so the due
// time is compared at the granularity of the minute-aligned window, not to the millisecond.
async function delayedDueTimes(queue: Queue): Promise<number[]> {
  return (await queue.getDelayed()).map((job) => job.timestamp + (job.opts.delay ?? 0));
}

describe("maintenance trigger", () => {
  test("a restart with another window replaces the scheduler and its delayed job", async () => {
    const prefix = `kumiko-test-maint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queue = new Queue(`${prefix}-worker`, {
      connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
    });
    queue.on("error", () => {});
    const schedulerId = schedulerIdForJobName("tidy:job:sweep");
    try {
      const first = startRunner(prefix, { hour: 3, minute: 0 });
      await first.start();
      await first.stop();
      const firstSchedulers = await queue.getJobSchedulers();
      expect(firstSchedulers.map((s) => [s.key, s.pattern, s.tz])).toEqual([
        [schedulerId, "0 3 * * *", "UTC"],
      ]);

      const second = startRunner(prefix, { hour: 5, minute: 30 });
      const before = Date.now();
      await second.start();
      const after = Date.now();
      await second.stop();

      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => [s.key, s.pattern, s.tz])).toEqual([
        [schedulerId, "30 5 * * *", "UTC"],
      ]);
      const dueTimes = await delayedDueTimes(queue);
      expect(dueTimes).toHaveLength(1);
      const [due] = dueTimes;
      expect(due).toBeDefined();
      const candidates = [nextUtc(5, 30, before), nextUtc(5, 30, after)];
      expect(candidates.some((expected) => Math.abs((due ?? 0) - expected) < 5_000)).toBe(true);
    } finally {
      await queue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });

  test("without a window the job runs at 03:00 UTC", async () => {
    const prefix = `kumiko-test-maint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queue = new Queue(`${prefix}-worker`, {
      connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
    });
    queue.on("error", () => {});
    try {
      const runner = startRunner(prefix);
      await runner.start();
      await runner.stop();
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => [s.pattern, s.tz])).toEqual([["0 3 * * *", "UTC"]]);
    } finally {
      await queue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });
});
