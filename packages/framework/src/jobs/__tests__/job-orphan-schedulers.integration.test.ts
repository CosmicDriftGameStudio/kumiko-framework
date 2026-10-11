// A cron job removed from the app must not keep firing from a leftover BullMQ
// job scheduler in Redis; schedulers of registered jobs and of the other lane
// stay untouched.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.js";
import type { AppContext } from "../../engine/types/index.js";
import { createTestRedis, type TestRedis } from "../../stack/index.js";
import {
  createJobRunner,
  ORPHAN_SCHEDULER_GRACE_MS,
  schedulerIdForJobName,
} from "../job-runner.js";
import { purgeRawRedisKeys } from "./purge-raw-redis-keys.js";

let testRedis: TestRedis;
let redisUrl: string;

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

function uniquePrefix(): string {
  return `kumiko-test-orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rawQueue(queueNamePrefix: string, lane: "worker" | "api"): Queue {
  const queue = new Queue(`${queueNamePrefix}-${lane}`, {
    connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
  });
  queue.on("error", () => {});
  return queue;
}

async function schedulerKeys(queue: Queue): Promise<string[]> {
  return (await queue.getJobSchedulers()).map((scheduler) => scheduler.key).sort();
}

const ORPHAN_NAME = "orphan:job:removed-from-app";
const template = { name: "ghost", data: {} };

type OrphanSetup = {
  prefix: string;
  keptId: string;
  workerQueue: Queue;
  apiQueue: Queue;
  seenKey: string;
  markSeen(schedulerId: string, ageMs: number): Promise<void>;
};

async function withOrphanRunner(
  seed: (setup: OrphanSetup) => Promise<void>,
  verify: (setup: OrphanSetup) => Promise<void>,
): Promise<void> {
  const prefix = uniquePrefix();
  const feature = defineFeature("orphan", (r) => {
    r.job("kept", { trigger: { cron: "0 0 1 1 *" } }, async () => {});
  });
  const workerQueue = rawQueue(prefix, "worker");
  const apiQueue = rawQueue(prefix, "api");
  const seenKey = workerQueue.toKey("kumiko-scheduler-seen");
  const setup: OrphanSetup = {
    prefix,
    keptId: schedulerIdForJobName("orphan:job:kept"),
    workerQueue,
    apiQueue,
    seenKey,
    async markSeen(schedulerId, ageMs) {
      const client = await workerQueue.client;
      await client.hset(seenKey, { [schedulerId]: String(Date.now() - ageMs) });
    },
  };
  const runner = createJobRunner({
    registry: createRegistry([feature]),
    context: {} as AppContext,
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: prefix,
  });
  try {
    await seed(setup);
    await runner.start();
    await verify(setup);
  } finally {
    await runner.stop();
    await workerQueue.close();
    await apiQueue.close();
    await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
    await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
  }
}

describe("orphan job schedulers", () => {
  test("an unseen orphan is removed, own and other-lane schedulers stay", async () => {
    const otherLaneId = schedulerIdForJobName("orphan:job:other-lane");
    await withOrphanRunner(
      async (s) => {
        await s.workerQueue.upsertJobScheduler(
          schedulerIdForJobName(ORPHAN_NAME),
          { pattern: "0 0 1 1 *" },
          template,
        );
        await s.apiQueue.upsertJobScheduler(otherLaneId, { pattern: "0 0 1 1 *" }, template);
      },
      async (s) => {
        expect(await schedulerKeys(s.workerQueue)).toEqual([s.keptId]);
        expect(await schedulerKeys(s.apiQueue)).toEqual([otherLaneId]);
      },
    );
  });

  test("an orphan another runner upserted within the grace period stays", async () => {
    const orphanId = schedulerIdForJobName(ORPHAN_NAME);
    await withOrphanRunner(
      async (s) => {
        await s.workerQueue.upsertJobScheduler(orphanId, { pattern: "0 0 1 1 *" }, template);
        await s.markSeen(orphanId, 1000);
      },
      async (s) => {
        expect(await schedulerKeys(s.workerQueue)).toEqual([s.keptId, orphanId].sort());
      },
    );
  });

  test("an orphan last seen before the grace period is removed with its seen entry", async () => {
    const orphanId = schedulerIdForJobName(ORPHAN_NAME);
    await withOrphanRunner(
      async (s) => {
        await s.workerQueue.upsertJobScheduler(orphanId, { pattern: "0 0 1 1 *" }, template);
        await s.markSeen(orphanId, ORPHAN_SCHEDULER_GRACE_MS + 60_000);
      },
      async (s) => {
        expect(await schedulerKeys(s.workerQueue)).toEqual([s.keptId]);
        const client = await s.workerQueue.client;
        expect(await client.hexists(s.seenKey, orphanId)).toBe(0);
        expect(await client.hexists(s.seenKey, s.keptId)).toBe(1);
      },
    );
  });

  test("a legacy scheduler id with colons is removed", async () => {
    const legacyId = "scheduler-orphan:job:legacy";
    await withOrphanRunner(
      async (s) => {
        await s.workerQueue.upsertJobScheduler(legacyId, { pattern: "0 0 1 1 *" }, template);
      },
      async (s) => {
        expect(await schedulerKeys(s.workerQueue)).toEqual([s.keptId]);
      },
    );
  });
});
