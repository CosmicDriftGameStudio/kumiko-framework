// A job's obs.log.error reaches the process log redacted, without data.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestRedis,
  type TestRedis,
  testRunQueueNamePrefix,
} from "@cosmicdrift/kumiko-testing/stack";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import type { Logger } from "../../logging/types.ts";
import { createJobRunner } from "../job-runner.ts";
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

type LogEntry = { readonly msg: string; readonly data: Record<string, unknown> | undefined };

describe("job obs.log in the pod log", () => {
  test("error is written redacted with job and runId, data stays out", async () => {
    const feature = defineFeature("podlog", (r) => {
      r.job({
        name: "logs-error",
        trigger: { manual: true },
        handler: async (_payload, ctx) => {
          ctx.obs.log.error("send to ops@example.com failed", { token: "data-secret" });
        },
      });
    });
    const errors: LogEntry[] = [];
    const log: Logger = {
      error: (msg, data) => {
        errors.push({ msg, data });
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
      child: () => log,
    };
    const context: AppContext = { log };
    const queueNamePrefix = testRunQueueNamePrefix("kumiko-test-podlog");
    const runner = createJobRunner({
      registry: createRegistry([feature]),
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });

    try {
      await runner.start();
      const jobId = await runner.dispatch("podlog:job:logs-error", {});
      await waitFor(() => expect(errors.some((e) => e.data?.["level"] === "error")).toBe(true), {
        delays: [250, 500, 1000, 2000],
      });
      const line = errors.find((e) => e.data?.["level"] === "error");
      expect(line?.msg).toBe("send to [redacted-address] failed");
      expect(line?.data).toEqual({ job: "podlog:job:logs-error", runId: jobId, level: "error" });
      expect(JSON.stringify(errors)).not.toContain("data-secret");
    } finally {
      await runner.stop();
      await purgeRawRedisKeys(testRedis.redisUrl, `bull:${queueNamePrefix}-worker:*`);
    }
  });
});
