// A scheduled job declared with `wakesSleepingApp: false` is scheduled under the
// `scheduler-nowake-` id the waker of sleeping shared apps skips, and a runner
// start drops the scheduler the job had under its previous id.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { createJobRunner, schedulerIdForJobName } from "../job-runner.ts";
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

const feature = defineFeature("sleepy", (r) => {
  r.job("sweep", { trigger: { cron: "0 * * * *", wakesSleepingApp: false } }, async () => {});
  r.job("tidy", { trigger: { maintenance: true } }, async () => {});
});

async function withRunner(
  seed: (queue: Queue) => Promise<void>,
  verify: (queue: Queue) => Promise<void>,
): Promise<void> {
  const prefix = `kumiko-test-nowake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = new Queue(`${prefix}-worker`, {
    connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
  });
  queue.on("error", () => {});
  const runner = createJobRunner({
    registry: createRegistry([feature]),
    context: {} as AppContext,
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: prefix,
  });
  try {
    await seed(queue);
    await runner.start();
    await verify(queue);
  } finally {
    await runner.stop();
    await queue.close();
    await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
    await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
  }
}

async function schedulerKeys(queue: Queue): Promise<string[]> {
  return (await queue.getJobSchedulers()).map((scheduler) => scheduler.key).sort();
}

describe("schedulers that do not wake a sleeping app", () => {
  test("the scheduler and its delayed job carry the nowake prefix, a waking job keeps the plain one", async () => {
    await withRunner(
      async () => {},
      async (queue) => {
        expect(await schedulerKeys(queue)).toEqual([
          "scheduler-nowake-sleepy-job-sweep",
          "scheduler-sleepy-job-tidy",
        ]);
        const delayedIds = (await queue.getDelayed()).map((job) => job.id ?? "").sort();
        expect(delayedIds).toHaveLength(2);
        expect(delayedIds[0]).toStartWith("repeat:scheduler-nowake-sleepy-job-sweep:");
        expect(delayedIds[1]).toStartWith("repeat:scheduler-sleepy-job-tidy:");
      },
    );
  });

  test("the scheduler under the previous id is removed at start, even when an older runner just stamped it", async () => {
    const previousId = schedulerIdForJobName("sleepy:job:sweep");
    await withRunner(
      async (queue) => {
        await queue.upsertJobScheduler(
          previousId,
          { pattern: "0 * * * *" },
          { name: "sleepy:job:sweep", data: {} },
        );
        const client = await queue.client;
        await client.hset(queue.toKey("kumiko-scheduler-seen"), {
          [previousId]: String(Date.now()),
        });
      },
      async (queue) => {
        expect(await schedulerKeys(queue)).toEqual([
          "scheduler-nowake-sleepy-job-sweep",
          "scheduler-sleepy-job-tidy",
        ]);
        const delayedIds = (await queue.getDelayed()).map((job) => job.id ?? "");
        expect(delayedIds.some((id) => id.startsWith(`repeat:${previousId}:`))).toBe(false);
      },
    );
  });

  test("the flag is rejected as true and on a trigger that is not scheduled", () => {
    const wakesAsTrue = { cron: "0 * * * *", wakesSleepingApp: true };
    const onManual = { manual: true, wakesSleepingApp: false };
    for (const trigger of [wakesAsTrue, onManual]) {
      expect(() =>
        createRegistry([
          defineFeature("bad", (r) => {
            // @ts-expect-error the type already rejects both, the boot check covers untyped callers
            r.job("sweep", { trigger }, async () => {});
          }),
        ]),
      ).toThrow("only false is valid, and only on a cron or maintenance trigger");
    }
  });
});
