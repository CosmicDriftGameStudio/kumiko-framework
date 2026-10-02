import { describe, expect, mock, test } from "bun:test";

// Simulates an unreachable Redis: waitUntilReady() never resolves. Everything
// else start() touches (Queue.on/close/add/upsertJobScheduler) is a no-op —
// with an empty registry those code paths aren't exercised anyway.
mock.module("bullmq", () => {
  class FakeQueue {
    on() {}
    close() {
      return Promise.resolve();
    }
    waitUntilReady() {
      return new Promise(() => {});
    }
    getJobCounts() {
      return Promise.resolve({});
    }
    removeJobScheduler() {
      return Promise.resolve();
    }
    upsertJobScheduler() {
      return Promise.resolve();
    }
    add() {
      return Promise.resolve();
    }
  }
  class FakeWorker {
    on() {}
    waitUntilReady() {
      return new Promise(() => {});
    }
    close() {
      return Promise.resolve();
    }
  }
  class UnrecoverableError extends Error {}
  return { Queue: FakeQueue, Worker: FakeWorker, UnrecoverableError };
});

import { createRegistry } from "../../engine/index.js";
import type { AppContext } from "../../engine/types/index.js";
import { createJobRunner } from "../job-runner.js";

describe("createJobRunner start() boot timeout", () => {
  test("rejects instead of hanging forever when the worker's Redis connection never becomes ready", async () => {
    const registry = createRegistry([]);
    const context: AppContext = {};
    const runner = createJobRunner({
      registry,
      context,
      redisUrl: "redis://localhost:6379",
      consumerLane: "worker",
      bootRedisTimeoutMs: 50,
    });

    await expect(runner.start()).rejects.toThrow(/Redis not reachable within 50ms \(lane=worker\)/);
  });

  test("stop() returns within the shutdown cap when queues never become ready, even with a long boot timeout", async () => {
    const runner = createJobRunner({
      registry: createRegistry([]),
      context: {},
      redisUrl: "redis://localhost:6379",
      bootRedisTimeoutMs: 60_000,
    });

    const startedAt = Date.now();
    await runner.stop();
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});
