// fw#3620: a failed job attempt must reach the process log (runner logger) with
// attempt/final markers, without leaking the payload.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRegistry, defineFeature } from "../../engine/index.js";
import type { AppContext } from "../../engine/types/index.js";
import type { Logger } from "../../logging/types.js";
import { createTestRedis, type TestRedis } from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";
import { createJobRunner } from "../job-runner.js";

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
  const context: AppContext = { log };
  return { context, errors };
}

function uniquePrefix(tag: string): string {
  return `kumiko-test-failedlog-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function purgeWorkerKeys(queueNamePrefix: string): Promise<void> {
  const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
  if (keys.length > 0) await testRedis.redis.del(...keys);
}

function failedLines(errors: readonly LogEntry[]): LogEntry[] {
  return errors.filter((entry) => entry.msg === "[job-runner] job failed");
}

describe("failed job attempts are logged (fw#3620)", () => {
  test("a throwing handler logs one line per attempt, final only on the last, without payload", async () => {
    const failFeature = defineFeature("failedlog", (r) => {
      r.job("always-fails", { trigger: { manual: true }, retries: 2 }, async () => {
        throw new Error("boom");
      });
    });
    const { context, errors } = captureContext();
    const queueNamePrefix = uniquePrefix("handler");
    const runner = createJobRunner({
      registry: createRegistry([failFeature]),
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });

    try {
      await runner.start();
      const jobId = await runner.dispatch("failedlog:job:always-fails", {
        secret: "payload-secret-value",
      });
      await waitFor(() => expect(failedLines(errors)).toHaveLength(3), {
        delays: [500, 1000, 2000, 3000],
      });

      const lines = failedLines(errors);
      expect(lines.map((l) => l.data?.["attempt"])).toEqual([1, 2, 3]);
      expect(lines.map((l) => l.data?.["final"])).toEqual([false, false, true]);
      for (const line of lines) {
        expect(line.data).toMatchObject({
          job: "failedlog:job:always-fails",
          jobId,
          error: "boom",
        });
      }
      expect(JSON.stringify(errors)).not.toContain("payload-secret-value");
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });

  test("a perTenant fan-out failure logs every attempt, final only on the last", async () => {
    const wrapperFeature = defineFeature("failedlogwrap", (r) => {
      r.job("fanout", { trigger: { manual: true }, perTenant: true, retries: 1 }, async () => {});
    });
    const { context, errors } = captureContext();
    const queueNamePrefix = uniquePrefix("wrapper");
    const runner = createJobRunner({
      registry: createRegistry([wrapperFeature]),
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
      getActiveTenantIds: async () => {
        throw new Error("tenant lookup down");
      },
    });

    try {
      await runner.start();
      await runner.dispatch("failedlogwrap:job:fanout", { secret: "payload-secret-value" });
      await waitFor(() => expect(failedLines(errors)).toHaveLength(2), {
        delays: [500, 1000, 2000, 3000],
      });

      const lines = failedLines(errors);
      expect(lines.map((l) => l.data?.["attempt"])).toEqual([1, 2]);
      expect(lines.map((l) => l.data?.["final"])).toEqual([false, true]);
      expect(lines[0]?.data?.["error"]).toBe("tenant lookup down");
      expect(JSON.stringify(errors)).not.toContain("payload-secret-value");
    } finally {
      await runner.stop();
      await purgeWorkerKeys(queueNamePrefix);
    }
  });
});
