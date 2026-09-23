// BullMQ's moveToFinished lua sweeps a queue's WHOLE
// completed/failed zset whenever any job finishes with keepJobs set, not
// just the finishing job, and only lazily (on a later finish into the same
// set). These tests exercise the real sweep against a real Redis, on every
// enqueue path, plus the runOnBoot marker and the perTenant invariant that
// keeps the sweep from breaking wrapper-retry child dedup.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import type { AppContext, TenantId } from "../../engine/types";
import { createTestRedis, type TestRedis } from "../../stack";
import { sleep, waitFor } from "../../testing";
import { bootJobIdForJobName, createJobRunner } from "../job-runner";

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
  return `kumiko-test-retention-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function purgeQueueKeys(queueNamePrefix: string): Promise<void> {
  const workerKeys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
  if (workerKeys.length > 0) await testRedis.redis.del(...workerKeys);
  const apiKeys = await testRedis.redis.keys(`bull:${queueNamePrefix}-api:*`);
  if (apiKeys.length > 0) await testRedis.redis.del(...apiKeys);
}

function rawWorkerQueue(queueNamePrefix: string): Queue {
  const queue = new Queue(`${queueNamePrefix}-worker`, {
    connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
  });
  // A post-close 'error' here is otherwise unhandled and bun:test attributes
  // it to whichever test runs next (fw#1805).
  queue.on("error", () => {});
  return queue;
}

describe("bounded job retention (fw#3199)", () => {
  test("completed jobs from every enqueue path are swept after the age once a later job completes", async () => {
    const queueNamePrefix = uniquePrefix("completed");
    const tenants = ["ret-a", "ret-b"] as TenantId[];
    const completed: Array<{ name: string; jobId: string }> = [];

    const feature = defineFeature("retention", (r) => {
      const someEvent = r.defineEvent("some-event", z.object({}), { piiFields: "none" });
      r.job("tick", { trigger: { manual: true } }, async () => {});
      r.job("onEvent", { trigger: { on: someEvent.name } }, async () => {});
      r.job("fanout", { trigger: { manual: true }, perTenant: true }, async () => {});
      r.job("cronJob", { trigger: { cron: "* * * * * *" } }, async () => {});
      r.job("sweeper", { trigger: { manual: true } }, async () => {});
    });

    const registry = createRegistry([feature]);
    const context: AppContext = {};
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      getActiveTenantIds: async () => tenants,
      jobRetention: { completedAgeSec: 1, failedAgeSec: 1 },
      onJobComplete: (name, jobId) => {
        completed.push({ name, jobId });
      },
    });

    const rawQueue = rawWorkerQueue(queueNamePrefix);
    try {
      await runner.start();
      const tickId = await runner.dispatch("retention:job:tick");
      await runner.handleEvent("retention:event:some-event", {});
      const wrapperId = await runner.dispatch("retention:job:fanout");

      await waitFor(() => {
        expect(completed.some((c) => c.jobId === tickId)).toBe(true);
        expect(completed.some((c) => c.name === "retention:job:on-event")).toBe(true);
        expect(completed.filter((c) => c.name === "retention:job:fanout").length).toBe(2);
        expect(completed.some((c) => c.name === "retention:job:cron-job")).toBe(true);
      });

      const cronId = completed.find((c) => c.name === "retention:job:cron-job")?.jobId;
      const eventId = completed.find((c) => c.name === "retention:job:on-event")?.jobId;
      const childIds = completed
        .filter((c) => c.name === "retention:job:fanout")
        .map((c) => c.jobId);

      await sleep(1200);

      await runner.dispatch("retention:job:sweeper");
      await waitFor(() => {
        expect(completed.some((c) => c.name === "retention:job:sweeper")).toBe(true);
      });

      const idsToCheck = [tickId, wrapperId, eventId, cronId, ...childIds].filter(
        (id): id is string => id !== undefined,
      );
      for (const id of idsToCheck) {
        await waitFor(async () => {
          expect(await rawQueue.getJob(id)).toBeUndefined();
        });
      }
    } finally {
      await rawQueue.close();
      await runner.stop();
      await purgeQueueKeys(queueNamePrefix);
    }
  });

  test("failed jobs are swept after the age once a later failure completes", async () => {
    const queueNamePrefix = uniquePrefix("failed");
    const failed: Array<{ name: string; jobId: string }> = [];

    const feature = defineFeature("retentionfail", (r) => {
      r.job("boom", { trigger: { manual: true } }, async () => {
        throw new Error("always fails");
      });
    });

    const registry = createRegistry([feature]);
    const context: AppContext = {};
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      jobRetention: { completedAgeSec: 1, failedAgeSec: 1 },
      onJobFailed: (name, jobId) => {
        failed.push({ name, jobId });
      },
    });

    const rawQueue = rawWorkerQueue(queueNamePrefix);
    try {
      await runner.start();
      const firstId = await runner.dispatch("retentionfail:job:boom");
      await waitFor(() => {
        expect(failed.some((f) => f.jobId === firstId)).toBe(true);
      });

      await sleep(1200);

      const secondId = await runner.dispatch("retentionfail:job:boom");
      await waitFor(() => {
        expect(failed.some((f) => f.jobId === secondId)).toBe(true);
      });

      await waitFor(async () => {
        expect(await rawQueue.getJob(firstId)).toBeUndefined();
      });
    } finally {
      await rawQueue.close();
      await runner.stop();
      await purgeQueueKeys(queueNamePrefix);
    }
  });

  test("runOnBoot marker survives the retention sweep and still dedupes across restarts", async () => {
    const queueNamePrefix = uniquePrefix("boot");
    let bootRuns = 0;
    let tickRuns = 0;

    const feature = defineFeature("retentionboot", (r) => {
      r.job("boot", { trigger: { manual: true }, runOnBoot: true }, async () => {
        bootRuns += 1;
      });
      r.job("tick", { trigger: { manual: true } }, async () => {
        tickRuns += 1;
      });
    });

    const registry1 = createRegistry([feature]);
    const context: AppContext = {};
    const runner1 = createJobRunner({
      registry: registry1,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      jobRetention: { completedAgeSec: 1, failedAgeSec: 1 },
    });

    const rawQueue = rawWorkerQueue(queueNamePrefix);
    const bootJobId = bootJobIdForJobName("retentionboot:job:boot");
    try {
      await runner1.start();
      await waitFor(() => {
        expect(bootRuns).toBe(1);
      });

      await sleep(1200);
      await runner1.dispatch("retentionboot:job:tick");
      await waitFor(() => {
        expect(tickRuns).toBe(1);
      });

      // Proves the sweep actually ran — without it this assertion (and the
      // regression it guards) would pass on the old fixed-job-id dedup too.
      await waitFor(async () => {
        expect(await rawQueue.getJob(bootJobId)).toBeUndefined();
      });

      await runner1.stop();

      const registry2 = createRegistry([feature]);
      const runner2 = createJobRunner({
        registry: registry2,
        context,
        redisUrl,
        consumerLane: "worker",
        queueNamePrefix,
        jobRetention: { completedAgeSec: 1, failedAgeSec: 1 },
      });
      try {
        await runner2.start();
        await sleep(300);
        expect(bootRuns).toBe(1);
      } finally {
        await runner2.stop();
      }
    } finally {
      await rawQueue.close();
      await purgeQueueKeys(queueNamePrefix);
    }
  });

  test("createJobRunner throws for a perTenant job whose retry window reaches the completed retention", () => {
    const feature = defineFeature("retentioninvariant", (r) => {
      r.job(
        "risky",
        {
          trigger: { manual: true },
          perTenant: true,
          retries: 2,
          backoff: { type: "fixed", delayMs: 1000 },
        },
        async () => {},
      );
    });
    const registry = createRegistry([feature]);
    expect(() =>
      createJobRunner({
        registry,
        context: {},
        redisUrl,
        consumerLane: "worker",
        queueNamePrefix: uniquePrefix("invariant"),
        jobRetention: { completedAgeSec: 1, failedAgeSec: 1 },
      }),
    ).toThrow(/retry window/);
  });

  test("createJobRunner does not throw for a non-perTenant job with the same retry config", async () => {
    const feature = defineFeature("retentionnonpertenant", (r) => {
      r.job(
        "risky",
        { trigger: { manual: true }, retries: 2, backoff: { type: "fixed", delayMs: 1000 } },
        async () => {},
      );
    });
    const registry = createRegistry([feature]);
    const queueNamePrefix = uniquePrefix("nonpertenant");
    let ran = false;
    const runner = createJobRunner({
      registry,
      context: {},
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      jobRetention: { completedAgeSec: 1, failedAgeSec: 1 },
      onJobComplete: () => {
        ran = true;
      },
    });
    try {
      await runner.start();
      await runner.dispatch("retentionnonpertenant:job:risky");
      await waitFor(() => {
        expect(ran).toBe(true);
      });
    } finally {
      await runner.stop();
      await purgeQueueKeys(queueNamePrefix);
    }
  });

  test.each([0, 1.5])("createJobRunner throws for jobRetention.completedAgeSec = %p", (value) => {
    const feature = defineFeature("retentionbadvalue", (r) => {
      r.job("noop", { trigger: { manual: true } }, async () => {});
    });
    const registry = createRegistry([feature]);
    expect(() =>
      createJobRunner({
        registry,
        context: {},
        redisUrl,
        consumerLane: "worker",
        queueNamePrefix: uniquePrefix("badvalue"),
        jobRetention: { completedAgeSec: value },
      }),
    ).toThrow();
  });
});
