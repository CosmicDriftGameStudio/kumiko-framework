import { describe, expect, test } from "bun:test";
import { withEnv } from "../../helpers/with-env.ts";
import { requireEnv } from "../db.ts";
import {
  ensureCurrentTestRunAlive,
  keepTestRunAlive,
  TEST_RUN_ID_ENV,
  testRunAliveKey,
  testRunQueueNamePrefix,
} from "../test-run.ts";

async function aliveKeyExists(runId: string): Promise<boolean> {
  const Redis = (await import("ioredis")).Redis;
  const redis = new Redis(requireEnv("REDIS_URL"), { lazyConnect: true });
  try {
    await redis.connect();
    return (await redis.exists(testRunAliveKey(runId))) === 1;
  } finally {
    redis.disconnect();
  }
}

describe("test run alive key", () => {
  test("outside a runner, building a queue prefix marks the process run alive", async () => {
    await withEnv({ [TEST_RUN_ID_ENV]: undefined }, async () => {
      const prefix = testRunQueueNamePrefix("alive");
      const runId = await ensureCurrentTestRunAlive(requireEnv("REDIS_URL"));
      expect(prefix).toStartWith(`kt-${runId}-alive-`);
      expect(await aliveKeyExists(runId)).toBe(true);
    });
  });

  test("a failing first mark is reported on the keeper instead of thrown", async () => {
    const keeper = await keepTestRunAlive("redis://127.0.0.1:1", "0123456789ab");
    try {
      expect(keeper.initialMarkError).toBeDefined();
    } finally {
      keeper.stop();
    }
  });
});
