// A cron job removed from the app must not keep firing from a leftover BullMQ
// job scheduler in Redis; schedulers of registered jobs and of the other lane
// stay untouched.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestRedis,
  type TestRedis,
  testRunQueueNamePrefix,
} from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import {
  createJobRunner,
  ORPHAN_SCHEDULER_GRACE_MS,
  schedulerIdForJobName,
} from "../job-runner.ts";
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

function uniquePrefix(): string {
  return testRunQueueNamePrefix("kumiko-test-orphan");
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
    r.job({ name: "kept", trigger: { cron: "0 0 1 1 *" }, handler: async () => {} });
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

  test("a failing orphan cleanup does not stop the start, the own scheduler is still registered", async () => {
    await withOrphanRunner(
      async (s) => {
        // WRONGTYPE on the seen hash: both the stamp and the orphan scan fail.
        const client = await s.workerQueue.client;
        await client.set(s.seenKey, "not-a-hash");
      },
      async (s) => {
        expect(await schedulerKeys(s.workerQueue)).toEqual([s.keptId]);
      },
    );
  });

  test("a running runner keeps its schedulers alive across a mixed-version restart longer than the grace period", async () => {
    const prefix = uniquePrefix();
    const withKept = defineFeature("orphan", (r) => {
      r.job({ name: "kept", trigger: { cron: "0 0 1 1 *" }, handler: async () => {} });
    });
    const withoutKept = defineFeature("orphan", (r) => {
      r.job({ name: "other", trigger: { manual: true }, handler: async () => {} });
    });
    const keptId = schedulerIdForJobName("orphan:job:kept");
    const newer = createJobRunner({
      registry: createRegistry([withKept]),
      context: {} as AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: prefix,
      schedulerSeenRefreshMs: 50,
    });
    const older = createJobRunner({
      registry: createRegistry([withoutKept]),
      context: {} as AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: prefix,
    });
    const workerQueue = rawQueue(prefix, "worker");
    const seenKey = workerQueue.toKey("kumiko-scheduler-seen");
    try {
      await newer.start();
      const client = await workerQueue.client;
      const staleStamp = Date.now() - ORPHAN_SCHEDULER_GRACE_MS - 60_000;
      await client.hset(seenKey, { [keptId]: String(staleStamp) });
      await waitFor(async () => Number(await client.hget(seenKey, keptId)) > staleStamp);

      await older.start();

      expect(await schedulerKeys(workerQueue)).toEqual([keptId]);
    } finally {
      await older.stop();
      await newer.stop();
      await workerQueue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });

  test("a failed initial stamp is repaired by the next refresh tick, which re-registers a scheduler removed meanwhile", async () => {
    const prefix = uniquePrefix();
    const feature = defineFeature("orphan", (r) => {
      r.job({ name: "kept", trigger: { cron: "0 0 1 1 *" }, handler: async () => {} });
    });
    const keptId = schedulerIdForJobName("orphan:job:kept");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {} as AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: prefix,
      schedulerSeenRefreshMs: 50,
    });
    const workerQueue = rawQueue(prefix, "worker");
    const seenKey = workerQueue.toKey("kumiko-scheduler-seen");
    try {
      const client = await workerQueue.client;
      // WRONGTYPE on the seen hash makes the initial stamp fail.
      await client.set(seenKey, "not-a-hash");
      await runner.start();

      await client.del(seenKey);
      await workerQueue.removeJobScheduler(keptId);

      await waitFor(async () => (await schedulerKeys(workerQueue)).includes(keptId));
      expect(await schedulerKeys(workerQueue)).toEqual([keptId]);
    } finally {
      await runner.stop();
      await workerQueue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });
});

describe("orphan job schedulers while the runner keeps running", () => {
  function runnerWithCronJob(
    prefix: string,
    jobName: string,
    wakesSleepingApp = true,
  ): ReturnType<typeof createJobRunner> {
    const feature = defineFeature("orphan", (r) => {
      r.job({
        name: jobName,
        trigger: wakesSleepingApp
          ? { cron: "0 0 1 1 *" }
          : { cron: "0 0 1 1 *", wakesSleepingApp: false },
        handler: async () => {},
      });
    });
    return createJobRunner({
      registry: createRegistry([feature]),
      context: {} as AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix: prefix,
      schedulerSeenRefreshMs: 50,
    });
  }

  // Each observed change of the runner's own stamp is one completed refresh tick.
  async function waitForRefreshTicks(queue: Queue, seenKey: string, schedulerId: string) {
    const client = await queue.client;
    const observedStamps = new Set<string>();
    await waitFor(
      async () => {
        const stamp = await client.hget(seenKey, schedulerId);
        if (stamp !== null) observedStamps.add(stamp);
        return observedStamps.size >= 4;
      },
      { delays: Array.from({ length: 80 }, () => 50) },
    );
  }

  test("a scheduler of the previous version survives the start and is removed by a refresh tick once its grace period ran out", async () => {
    const prefix = uniquePrefix();
    const runner = runnerWithCronJob(prefix, "kept");
    const keptId = schedulerIdForJobName("orphan:job:kept");
    const orphanId = schedulerIdForJobName(ORPHAN_NAME);
    const workerQueue = rawQueue(prefix, "worker");
    const seenKey = workerQueue.toKey("kumiko-scheduler-seen");
    try {
      const client = await workerQueue.client;
      await workerQueue.upsertJobScheduler(orphanId, { pattern: "0 0 1 1 *" }, template);
      await client.hset(seenKey, { [orphanId]: String(Date.now() - 1000) });

      await runner.start();
      expect(await schedulerKeys(workerQueue)).toEqual([keptId, orphanId].sort());

      // The previous version stopped stamping; its last stamp is now older than the grace period.
      await client.hset(seenKey, {
        [orphanId]: String(Date.now() - ORPHAN_SCHEDULER_GRACE_MS - 60_000),
      });

      await waitFor(async () => !(await schedulerKeys(workerQueue)).includes(orphanId));
      expect(await schedulerKeys(workerQueue)).toEqual([keptId]);
      expect(await client.hexists(seenKey, orphanId)).toBe(0);
    } finally {
      await runner.stop();
      await workerQueue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });

  test("a scheduler another live runner keeps stamping survives several refresh ticks", async () => {
    const prefix = uniquePrefix();
    const owner = runnerWithCronJob(prefix, "kept");
    const other = runnerWithCronJob(prefix, "other");
    const keptId = schedulerIdForJobName("orphan:job:kept");
    const otherId = schedulerIdForJobName("orphan:job:other");
    const workerQueue = rawQueue(prefix, "worker");
    const seenKey = workerQueue.toKey("kumiko-scheduler-seen");
    try {
      await owner.start();
      await other.start();

      await waitForRefreshTicks(workerQueue, seenKey, otherId);

      expect(await schedulerKeys(workerQueue)).toEqual([keptId, otherId].sort());
    } finally {
      await other.stop();
      await owner.stop();
      await workerQueue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });

  test("an older runner's refresh tick leaves the scheduler a newer runner registered with the other wake flag", async () => {
    const prefix = uniquePrefix();
    const older = runnerWithCronJob(prefix, "probe");
    const newer = runnerWithCronJob(prefix, "probe", false);
    const olderId = schedulerIdForJobName("orphan:job:probe");
    const newerId = schedulerIdForJobName("orphan:job:probe", false);
    const workerQueue = rawQueue(prefix, "worker");
    const seenKey = workerQueue.toKey("kumiko-scheduler-seen");
    try {
      await older.start();
      await newer.start();
      expect(await schedulerKeys(workerQueue)).toEqual([newerId]);

      await waitForRefreshTicks(workerQueue, seenKey, olderId);

      expect(await schedulerKeys(workerQueue)).toEqual([newerId]);
    } finally {
      await newer.stop();
      await older.stop();
      await workerQueue.close();
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-worker:*`);
      await purgeRawRedisKeys(redisUrl, `bull:${prefix}-api:*`);
    }
  });
});
