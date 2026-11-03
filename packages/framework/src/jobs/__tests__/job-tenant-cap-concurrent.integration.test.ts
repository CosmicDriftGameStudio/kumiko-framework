import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { createJobRunner } from "../job-runner.ts";
import { purgeRawRedisKeys } from "./purge-raw-redis-keys.ts";
import { createReleaseGate } from "./release-gate.ts";

const CAP = 2;
const SKIPPED = "skipped:max-per-tenant";

let testRedis: TestRedis;
let redisUrl: string;

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

describe("maxPerTenant skip cap under concurrent dispatch", () => {
  test("simultaneous dispatches from api and worker runners admit exactly the cap", async () => {
    const gate = createReleaseGate();
    gate.hold();
    const feature = defineFeature("capburst", (r) => {
      r.job("limited", { trigger: { manual: true }, maxPerTenant: CAP }, async () => {
        await gate.wait();
      });
    });
    const queueNamePrefix = `kumiko-test-capburst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const options = {
      registry: createRegistry([feature]),
      context: {} satisfies AppContext,
      redisUrl,
      queueNamePrefix,
    };
    const workerRunner = createJobRunner({ ...options, consumerLane: "worker" });
    const apiRunner = createJobRunner({ ...options, consumerLane: "api" });
    try {
      await workerRunner.start();
      await apiRunner.start();
      const dispatches = Array.from({ length: 12 }, (_, n) =>
        (n % 2 === 0 ? workerRunner : apiRunner).dispatch("capburst:job:limited", {
          n,
          _tenantId: "tenant-burst",
        }),
      );
      const ids = await Promise.all(dispatches);
      expect(ids.filter((id) => id !== SKIPPED)).toHaveLength(CAP);
    } finally {
      gate.release();
      await apiRunner.stop();
      await workerRunner.stop();
      await purgeRawRedisKeys(redisUrl, `bull:${queueNamePrefix}-*:*`);
    }
  });
});
