import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { bootJobIdForJobName, createJobRunner, type JobMeta } from "../job-runner.ts";

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
  return `kumiko-test-defer-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function purgeWorkerKeys(queueNamePrefix: string): Promise<void> {
  const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
  if (keys.length > 0) await testRedis.redis.del(...keys);
}

describe("ctx.defer", () => {
  test("defers twice without consuming an attempt, a failure or a failed run, then succeeds", async () => {
    let runs = 0;
    const attemptsSeen: Array<number | undefined> = [];
    const events: string[] = [];
    const feature = defineFeature("deferok", (r) => {
      r.job(
        "busy",
        { trigger: { manual: true }, runOnBoot: true, retries: 1, concurrency: "sequential" },
        async (_payload, ctx) => {
          runs += 1;
          if (runs <= 2) return ctx.defer(50);
        },
      );
    });
    const queueNamePrefix = uniquePrefix("ok");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobStart: (_name, _id, meta: JobMeta) => {
        attemptsSeen.push(meta.attempt);
        events.push("start");
      },
      onJobDeferred: () => {
        events.push("deferred");
      },
      onJobComplete: () => {
        events.push("complete");
      },
      onJobFailed: () => {
        events.push("failed");
      },
    });
    const queue = new Queue(`${queueNamePrefix}-worker`, { connection: { url: redisUrl } });
    try {
      await runner.start();
      await waitFor(() => expect(events).toContain("complete"));
      expect(events).toEqual(["start", "deferred", "start", "deferred", "start", "complete"]);
      expect(attemptsSeen).toEqual([1, 1, 1]);
      const job = await queue.getJob(bootJobIdForJobName("deferok:job:busy"));
      expect(job?.attemptsMade).toBe(1);
      expect(job?.data["_handlerDeferCount"]).toBe(2);
    } finally {
      await queue.close();
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("exceeding maxDefers fails the run with a clear message", async () => {
    const failures: string[] = [];
    let deferred = 0;
    const feature = defineFeature("defercap", (r) => {
      r.job(
        "forever",
        { trigger: { manual: true }, runOnBoot: true, maxDefers: 2, retries: 2 },
        async (_payload, ctx) => ctx.defer(30),
      );
    });
    const queueNamePrefix = uniquePrefix("cap");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobDeferred: () => {
        deferred += 1;
      },
      onJobFailed: (_name, _id, error) => {
        failures.push(error);
      },
    });
    try {
      await runner.start();
      await waitFor(() => expect(failures.length).toBe(1));
      expect(failures[0]).toContain("maxDefers");
      expect(deferred).toBe(2);
      await Bun.sleep(1500);
      expect(failures).toHaveLength(1);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("a throwing onJobDeferred hook still defers and records no failure", async () => {
    let runs = 0;
    let failed = 0;
    const feature = defineFeature("deferhook", (r) => {
      r.job("busy", { trigger: { manual: true }, runOnBoot: true }, async (_payload, ctx) => {
        runs += 1;
        if (runs === 1) return ctx.defer(30);
      });
    });
    const queueNamePrefix = uniquePrefix("hook");
    let completed = 0;
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobDeferred: () => {
        throw new Error("run log unreachable");
      },
      onJobComplete: () => {
        completed += 1;
      },
      onJobFailed: () => {
        failed += 1;
      },
    });
    try {
      await runner.start();
      await waitFor(() => expect(completed).toBe(1));
      expect(runs).toBe(2);
      expect(failed).toBe(0);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("an inline boot gate cannot defer", async () => {
    const feature = defineFeature("deferinline", (r) => {
      r.job("gate", { trigger: { manual: true }, bootGate: true }, async (_payload, ctx) =>
        ctx.defer(10),
      );
    });
    const queueNamePrefix = uniquePrefix("inline");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });
    try {
      await expect(runner.start()).rejects.toThrow("ctx.defer needs a queued run");
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("a non-positive defer delay fails the run", async () => {
    const failures: string[] = [];
    const feature = defineFeature("deferzero", (r) => {
      r.job("zero", { trigger: { manual: true }, runOnBoot: true }, async (_payload, ctx) =>
        ctx.defer(0),
      );
    });
    const queueNamePrefix = uniquePrefix("zero");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobFailed: (_name, _id, error) => {
        failures.push(error);
      },
    });
    try {
      await runner.start();
      await waitFor(() => expect(failures).toHaveLength(1));
      expect(failures[0]).toContain("ctx.defer needs a positive integer delay");
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});
