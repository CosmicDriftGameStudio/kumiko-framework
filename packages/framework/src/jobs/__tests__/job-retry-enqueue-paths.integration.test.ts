// fw#3184: buildRetryBullOpts (attempts/backoff derived from a job's
// `retries`/`backoff`) was only wired into dispatch() and handleEvent().
// Cron, runOnBoot, the perTenant wrapper, its fanned-out children, and the
// sequential re-enqueue path all called queue.add() without it, so a job
// with `retries` set still failed for good on its very first error when
// reached through any of those paths. Where a fresh job could also rerun the
// handler (a new cron tick, a sequential re-enqueue), the test asserts a
// SECOND attempt on the SAME BullMQ job id — "the handler ran again
// eventually" would pass without the fix there.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine";
import type { AppContext, TenantId } from "../../engine/types";
import { createTestRedis, type TestRedis } from "../../stack";
import { sleep, waitFor } from "../../testing";
import { bootJobIdForJobName, createJobRunner, type JobMeta } from "../job-runner";

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
  return `kumiko-test-retry-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function purgeWorkerKeys(queueNamePrefix: string): Promise<void> {
  // Cron leaves its repeatable scheduler firing into a stopped worker if not
  // purged — the same hazard the jobs.integration.test.ts helper guards
  // against.
  const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
  if (keys.length > 0) await testRedis.redis.del(...keys);
}

describe("job retries on every enqueue path (fw#3184)", () => {
  test("cron: a job with retries recovers via a second attempt on the same BullMQ job id", async () => {
    let callCount = 0;
    const starts: Array<{ jobId: string; attempt: number | undefined }> = [];
    const cronFeature = defineFeature("retrycron", (r) => {
      r.job("flaky", { trigger: { cron: "* * * * * *" }, retries: 1 }, async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("fails on first cron tick");
      });
    });

    const registry = createRegistry([cronFeature]);
    const context: AppContext = {};
    const queueNamePrefix = uniquePrefix("cron");
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobStart: (_name, jobId, meta: JobMeta) => {
        starts.push({ jobId, attempt: meta.attempt });
      },
    });

    try {
      await runner.start();
      await waitFor(
        () => {
          const byJob = new Map<string, number>();
          for (const s of starts)
            byJob.set(s.jobId, Math.max(byJob.get(s.jobId) ?? 0, s.attempt ?? 0));
          const reachedRetry = [...byJob.values()].some((attempt) => attempt >= 2);
          expect(reachedRetry).toBe(true);
        },
        { delays: [500, 1000, 2000, 3000] },
      );
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("runOnBoot: a job with retries recovers via a second attempt on the boot job id", async () => {
    const starts: Array<{ jobId: string; attempt: number | undefined }> = [];
    let callCount = 0;
    const bootFeature = defineFeature("retryboot", (r) => {
      r.job("flaky", { trigger: { manual: true }, runOnBoot: true, retries: 1 }, async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("fails on first boot run");
      });
    });

    const registry = createRegistry([bootFeature]);
    const context: AppContext = {};
    const queueNamePrefix = uniquePrefix("boot");
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobStart: (_name, jobId, meta: JobMeta) => {
        starts.push({ jobId, attempt: meta.attempt });
      },
    });

    const expectedJobId = bootJobIdForJobName("retryboot:job:flaky");
    try {
      await runner.start();
      await waitFor(() => {
        const attempts = starts.filter((s) => s.jobId === expectedJobId).map((s) => s.attempt);
        expect(attempts).toContain(2);
      });
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("perTenant child: a job with retries recovers per tenant via a second attempt", async () => {
    const starts: Array<{ jobId: string; attempt: number | undefined }> = [];
    const callCountByTenant = new Map<string, number>();
    const tenants = ["retry-child-a", "retry-child-b"] as TenantId[];
    const perTenantFeature = defineFeature("retrychild", (r) => {
      r.job(
        "flaky",
        { trigger: { manual: true }, perTenant: true, retries: 1 },
        async (_payload, ctx) => {
          const tenantId = String(ctx.systemUser.tenantId);
          const count = (callCountByTenant.get(tenantId) ?? 0) + 1;
          callCountByTenant.set(tenantId, count);
          if (count === 1) throw new Error(`fails on first attempt for ${tenantId}`);
        },
      );
    });

    const registry = createRegistry([perTenantFeature]);
    const context: AppContext = {};
    const queueNamePrefix = uniquePrefix("child");
    const getActiveTenantIds = async () => tenants;
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      getActiveTenantIds,
      onJobStart: (name, jobId, meta: JobMeta) => {
        if (name === "retrychild:job:flaky") starts.push({ jobId, attempt: meta.attempt });
      },
    });

    try {
      await runner.start();
      await runner.dispatch("retrychild:job:flaky");
      await waitFor(() => {
        for (const tenantId of tenants) {
          expect(callCountByTenant.get(tenantId)).toBe(2);
        }
      });
      const byJob = new Map<string, number>();
      for (const s of starts) byJob.set(s.jobId, Math.max(byJob.get(s.jobId) ?? 0, s.attempt ?? 0));
      expect([...byJob.values()].some((attempt) => attempt >= 2)).toBe(true);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("perTenant wrapper: retries on getActiveTenantIds failure without double-fanning-out", async () => {
    const tenants = ["retry-wrapper-a", "retry-wrapper-b"] as TenantId[];
    const handlerCalls = new Map<string, number>();
    let getActiveTenantIdsCalls = 0;
    const wrapperFeature = defineFeature("retrywrapper", (r) => {
      r.job(
        "fanout",
        { trigger: { manual: true }, perTenant: true, retries: 1 },
        async (_payload, ctx) => {
          const tenantId = String(ctx.systemUser.tenantId);
          handlerCalls.set(tenantId, (handlerCalls.get(tenantId) ?? 0) + 1);
        },
      );
    });

    const registry = createRegistry([wrapperFeature]);
    const context: AppContext = {};
    const queueNamePrefix = uniquePrefix("wrapper");
    const getActiveTenantIds = async () => {
      getActiveTenantIdsCalls += 1;
      if (getActiveTenantIdsCalls === 1)
        throw new Error("fails resolving tenants on first attempt");
      return tenants;
    };
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      getActiveTenantIds,
    });

    try {
      await runner.start();
      await runner.dispatch("retrywrapper:job:fanout");
      await waitFor(() => {
        for (const tenantId of tenants) {
          expect(handlerCalls.get(tenantId)).toBe(1);
        }
      });
      // A wrapper retry re-derives the same child ids from its own stable
      // BullMQ job id, so a late second fan-out would be a no-op on
      // existing-jobId add() — but nothing should even attempt one here.
      await sleep(400);
      for (const tenantId of tenants) {
        expect(handlerCalls.get(tenantId)).toBe(1);
      }
      expect(getActiveTenantIdsCalls).toBe(2);
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("sequential re-enqueue: a job with retries recovers via a second attempt on the re-enqueued job id", async () => {
    const starts: Array<{ jobId: string; attempt: number | undefined }> = [];
    let callCount = 0;
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const sequentialFeature = defineFeature("retryseq", (r) => {
      r.job(
        "flaky",
        { trigger: { manual: true }, concurrency: "sequential", retries: 1 },
        async () => {
          callCount += 1;
          const attemptNumber = callCount;
          if (attemptNumber === 1) {
            await gate;
            return;
          }
          if (attemptNumber === 2) throw new Error("fails on second call (first retry slot)");
        },
      );
    });

    const registry = createRegistry([sequentialFeature]);
    const context: AppContext = {};
    const queueNamePrefix = uniquePrefix("seq");
    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobStart: (_name, jobId, meta: JobMeta) => {
        starts.push({ jobId, attempt: meta.attempt });
      },
    });

    const rawQueue = new Queue(`${queueNamePrefix}-worker`, {
      connection: { host: testRedis.redis.options.host, port: testRedis.redis.options.port },
    });
    // A post-close 'error' here is otherwise unhandled and bun:test
    // attributes it to whichever test runs next (fw#1805).
    rawQueue.on("error", () => {});

    try {
      await runner.start();
      const firstJobId = await runner.dispatch("retryseq:job:flaky");
      const secondJobId = await runner.dispatch("retryseq:job:flaky");

      await waitFor(() => {
        expect(callCount).toBeGreaterThanOrEqual(1);
      });

      // Wait until the second dispatch's held-lock re-enqueue has actually
      // landed as a delayed job before releasing the gate — otherwise the
      // gate could resolve before there is anything left to retry.
      await waitFor(
        async () => {
          const delayed = await rawQueue.getDelayed();
          expect(delayed.some((j) => j.name === "retryseq:job:flaky")).toBe(true);
        },
        { delays: [100, 200, 400, 800] },
      );

      releaseGate?.();

      await waitFor(() => {
        const byJob = new Map<string, number>();
        for (const s of starts)
          byJob.set(s.jobId, Math.max(byJob.get(s.jobId) ?? 0, s.attempt ?? 0));
        const retriedJobId = [...byJob.entries()].find(
          ([jobId, attempt]) => attempt >= 2 && jobId !== firstJobId && jobId !== secondJobId,
        );
        expect(retriedJobId).toBeDefined();
      });
    } finally {
      await rawQueue.close();
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});
