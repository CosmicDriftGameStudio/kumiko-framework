// Failures that happen before the handler span exists (unknown job, fan-out
// setup) must still reach onJobFailed and the process log.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext, TenantId } from "../../engine/types/index.ts";
import type { Logger } from "../../logging/types.ts";
import { createJobRunner } from "../job-runner.ts";

let testRedis: TestRedis;
let redisUrl: string;

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

type LogEntry = { readonly msg: string; readonly data: Record<string, unknown> | undefined };
type Failure = { readonly jobName: string; readonly error: string };

function captureContext(): { readonly context: AppContext; readonly errors: LogEntry[] } {
  const errors: LogEntry[] = [];
  const log: Logger = {
    error: (msg: string, data?: Record<string, unknown>) => {
      errors.push({ msg, data });
    },
    warn: () => {},
    info: () => {},
    debug: () => {},
    child: () => log,
  };
  return { context: { log }, errors };
}

function uniquePrefix(tag: string): string {
  return `kumiko-test-prerun-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function purgeWorkerKeys(queueNamePrefix: string): Promise<void> {
  const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
  if (keys.length > 0) await testRedis.redis.del(...keys);
}

function failedLines(errors: readonly LogEntry[]): LogEntry[] {
  return errors.filter((entry) => entry.msg === "job failed");
}

function openRawQueue(queueNamePrefix: string): Queue {
  const rawQueue = new Queue(`${queueNamePrefix}-worker`, {
    connection: {
      host: testRedis.redis.options.host,
      port: testRedis.redis.options.port,
      db: testRedis.redis.options.db,
    },
  });
  // A post-close 'error' here is otherwise unhandled and bun:test
  // attributes it to whichever test runs next.
  rawQueue.on("error", () => {});
  return rawQueue;
}

describe("pre-run job failures", () => {
  test("a queued job with an unknown name fails once, final, with Unknown job", async () => {
    const feature = defineFeature("prerununknown", (r) => {
      r.job("known", { trigger: { manual: true } }, async () => {});
    });
    const { context, errors } = captureContext();
    const failures: Failure[] = [];
    const queueNamePrefix = uniquePrefix("unknown");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobFailed: (jobName, _id, error) => {
        failures.push({ jobName, error });
      },
    });
    const rawQueue = openRawQueue(queueNamePrefix);
    const missingName = "prerununknown:job:missing";
    try {
      await runner.start();
      await rawQueue.add(missingName, {});
      await waitFor(() => expect(failures).toHaveLength(1));
      expect(failures[0]).toEqual({ jobName: missingName, error: `Unknown job: ${missingName}` });
      await waitFor(() => expect(failedLines(errors)).toHaveLength(1));
      expect(failedLines(errors)[0]?.data).toMatchObject({
        job: missingName,
        attempt: 1,
        final: true,
      });
    } finally {
      await runner.stop();
      await rawQueue.close();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("a perTenant wrapper for an unknown job fails final with Unknown job", async () => {
    const feature = defineFeature("prerunwrap", (r) => {
      r.job("known", { trigger: { manual: true } }, async () => {});
    });
    const { context, errors } = captureContext();
    const failures: Failure[] = [];
    const queueNamePrefix = uniquePrefix("wrapunknown");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      getActiveTenantIds: async () => ["t1" as TenantId],
      onJobFailed: (jobName, _id, error) => {
        failures.push({ jobName, error });
      },
    });
    const rawQueue = openRawQueue(queueNamePrefix);
    const missingName = "prerunwrap:job:missing";
    try {
      await runner.start();
      await rawQueue.add(`_perTenant:${missingName}`, {});
      await waitFor(() => expect(failures).toHaveLength(1));
      expect(failures[0]).toEqual({
        jobName: `_perTenant:${missingName}`,
        error: `Unknown job: ${missingName}`,
      });
      await waitFor(() => expect(failedLines(errors)).toHaveLength(1));
      expect(failedLines(errors)[0]?.data).toMatchObject({
        job: `_perTenant:${missingName}`,
        attempt: 1,
        final: true,
      });
    } finally {
      await runner.stop();
      await rawQueue.close();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("a perTenant job without a tenant resolver fails with the resolver hint", async () => {
    const feature = defineFeature("prerunnoresolver", (r) => {
      r.job("fanout", { trigger: { manual: true }, perTenant: true }, async () => {});
    });
    const { context } = captureContext();
    const failures: Failure[] = [];
    const queueNamePrefix = uniquePrefix("noresolver");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      onJobFailed: (jobName, _id, error) => {
        failures.push({ jobName, error });
      },
    });
    try {
      await runner.start();
      await runner.dispatch("prerunnoresolver:job:fanout", {});
      await waitFor(() => expect(failures).toHaveLength(1));
      expect(failures[0]?.error).toContain("requires either options.getActiveTenantIds");
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});
