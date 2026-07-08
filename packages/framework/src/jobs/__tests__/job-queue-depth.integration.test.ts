import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRegistry, defineFeature } from "../../engine";
import type { AppContext, Registry } from "../../engine/types";
import { createPrometheusMeter, registerStandardMetrics } from "../../observability";
import { createTestRedis, type TestRedis } from "../../stack";
import { sleep } from "../../testing";
import { createJobRunner } from "../job-runner";

let testRedis: TestRedis;
let redisUrl: string;

const testFeature = defineFeature("test-queue-depth", (r) => {
  r.job("noop", { trigger: { manual: true } }, async () => {});
});

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

describe("job-runner — kumiko_job_queue_depth", () => {
  test("start() polls BullMQ counts into the gauge, stop() tears the poller down", async () => {
    const registry: Registry = createRegistry([testFeature]);
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);
    const context: AppContext = { meter };
    const queueNamePrefix = `kumiko-test-qd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const runner = createJobRunner({
      registry,
      context,
      redisUrl,
      consumerLane: "worker",
      queueNamePrefix,
    });

    try {
      await runner.start();

      const snapshot = meter.snapshot().get("kumiko_job_queue_depth");
      expect(snapshot).toBeDefined();
      const waitingSlot = snapshot?.slots.find(
        (s) => s.labels?.["lane"] === "worker" && s.labels?.["state"] === "waiting",
      );
      expect(waitingSlot).toBeDefined();
      expect((waitingSlot as { value: number }).value).toBe(0);
      // BullMQ's fresh Worker connection is still settling right after
      // start() returns (no boot/cron job here to have already warmed it
      // up, unlike every other scenario in this suite) — stop() immediately
      // after start() races the Worker's own connection teardown and throws
      // an unrelated "Connection is closed" from ioredis. Production runners
      // live far longer than this; the race is a test-only artifact of
      // start()+stop() with zero work in between.
      await sleep(50);
    } finally {
      await runner.stop();
      const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
      if (keys.length > 0) await testRedis.redis.del(...keys);
    }
  });

  test("enqueuer-only runner (no consumerLane) never polls — no gauge slots", async () => {
    const registry: Registry = createRegistry([testFeature]);
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);
    const context: AppContext = { meter };
    const queueNamePrefix = `kumiko-test-qd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const runner = createJobRunner({ registry, context, redisUrl, queueNamePrefix });
    try {
      await runner.start();
      const snapshot = meter.snapshot().get("kumiko_job_queue_depth");
      expect(snapshot?.slots.length ?? 0).toBe(0);
    } finally {
      await runner.stop();
    }
  });
});
