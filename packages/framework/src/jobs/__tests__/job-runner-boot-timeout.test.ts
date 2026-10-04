import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TCPSocketListener } from "bun";
import { createRegistry } from "../../engine/index.js";
import type { AppContext } from "../../engine/types/index.js";
import { createJobRunner } from "../job-runner.js";

// A Redis that accepts the TCP connection but never answers: ioredis's ready check never
// completes, so BullMQ's waitUntilReady() never resolves. A real server instead of
// mock.module("bullmq"): module mocks are process-wide in bun and broke every later
// integration file in the same `bun test` run.
let silentRedis: TCPSocketListener<undefined>;
let silentRedisUrl: string;

beforeAll(() => {
  silentRedis = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  silentRedisUrl = `redis://127.0.0.1:${silentRedis.port}`;
});

afterAll(() => {
  silentRedis.stop(true);
});

describe("createJobRunner start() boot timeout", () => {
  test("rejects instead of hanging forever when the worker's Redis connection never becomes ready", async () => {
    const context: AppContext = {};
    const runner = createJobRunner({
      registry: createRegistry([]),
      context,
      redisUrl: silentRedisUrl,
      consumerLane: "worker",
      bootRedisTimeoutMs: 50,
    });

    try {
      await expect(runner.start()).rejects.toThrow(
        /Redis not reachable within 50ms \(lane=worker\)/,
      );
    } finally {
      await runner.stop();
    }
  });

  test("stop() returns within the shutdown cap when queues never become ready, even with a long boot timeout", async () => {
    const runner = createJobRunner({
      registry: createRegistry([]),
      context: {},
      redisUrl: silentRedisUrl,
      bootRedisTimeoutMs: 60_000,
    });

    const startedAt = Date.now();
    await runner.stop();
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});
