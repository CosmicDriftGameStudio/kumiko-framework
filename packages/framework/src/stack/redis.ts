import { generateId } from "../utils";
import { requireEnv } from "./db";

export type TestRedis = {
  redis: import("ioredis").default;
  // The exact REDIS_URL used to build `redis` above — for a second, unrelated
  // connection (e.g. the test-stack's JobRunner) that needs its own client
  // rather than sharing this one's keyPrefix. Reconstructing a URL from
  // `redis.options` loses password/username/tls/path (pr-review
  // kumiko-framework #1036/2) — callers needing a fresh connection should use
  // this raw string, not rebuild one from parsed options.
  redisUrl: string;
  /** Delete every key this test created (prefix-scoped). Replaces the old
   *  `redis.flushdb()` — that wiped other parallel tests' BullMQ state. */
  flushNamespace: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export async function createTestRedis(): Promise<TestRedis> {
  const Redis = (await import("ioredis")).default;
  const redisUrl = requireEnv("REDIS_URL");
  // Every test gets a per-file key prefix on a shared DB (no DB-pool-of-15
  // round-robin). Collisions at birthday-paradox rates are gone — the
  // prefix space is unbounded. See Track B.3 in docs/plans/tests-refactor.
  const prefix = `kt:${generateId().slice(-8)}:`;
  const redis = new Redis(redisUrl, { keyPrefix: prefix });

  async function flushNamespace(): Promise<void> {
    // Open a prefix-less client for the scan — ioredis' keyPrefix is applied
    // per-command but SCAN's returned keys are full names, so managing the
    // del set with the prefix already on the connection is error-prone.
    const raw = new Redis(redisUrl);
    try {
      const stream = raw.scanStream({ match: `${prefix}*`, count: 500 });
      const keys: string[] = [];
      for await (const batch of stream) keys.push(...batch);
      if (keys.length > 0) await raw.del(...keys);
    } finally {
      raw.disconnect();
    }
  }

  return {
    redis,
    redisUrl,
    flushNamespace,
    cleanup: async () => {
      await flushNamespace();
      redis.disconnect();
    },
  };
}
