import { generateId } from "../utils/index.js";
import { requireEnv } from "./db.js";

export type TestRedis = {
  redis: import("ioredis").Redis;
  // The exact REDIS_URL used to build `redis` above — for a second, unrelated
  // connection (e.g. the test-stack's JobRunner) that needs its own client
  // rather than sharing this one's keyPrefix. Reconstructing a URL from
  // `redis.options` loses password/username/tls/path (pr-review
  // kumiko-framework #1036/2) — callers needing a fresh connection should use
  // this raw string, not rebuild one from parsed options.
  redisUrl: string;
  /** The per-test `keyPrefix` on `redis`, e.g. `kt:1a2b3c4d:`. */
  keyPrefix: string;
  /** Delete every key this test created (prefix-scoped). Replaces the old
   *  `redis.flushdb()` — that wiped other parallel tests' BullMQ state. */
  flushNamespace: () => Promise<void>;
  cleanup: () => Promise<void>;
};

// BullMQ queues live on the raw redisUrl, outside the test Redis keyPrefix, so
// parallel stacks sharing the prod default queue name would consume each
// other's jobs. BullMQ rejects `:` in queue names.
export function queueNamePrefixForTestRedis(keyPrefix: string): string {
  return keyPrefix.split(":").filter(Boolean).join("-");
}

export type CreateTestRedisOptions = {
  /** Reuse another stack's keyPrefix on a fresh connection. cleanup() then only
   *  disconnects — the owning stack flushes the namespace and its queues. */
  readonly borrowKeyPrefix?: string;
};

export async function createTestRedis(opts: CreateTestRedisOptions = {}): Promise<TestRedis> {
  const Redis = (await import("ioredis")).Redis;
  const redisUrl = requireEnv("REDIS_URL");
  // Every test gets a per-file key prefix on a shared DB (no DB-pool-of-15
  // round-robin). Collisions at birthday-paradox rates are gone — the
  // prefix space is unbounded. See Track B.3 in docs/plans/tests-refactor.
  const prefix = opts.borrowKeyPrefix ?? `kt:${generateId().slice(-8)}:`;
  const redis = new Redis(redisUrl, { keyPrefix: prefix });

  async function deleteKeysMatching(pattern: string): Promise<void> {
    // Open a prefix-less client for the scan — ioredis' keyPrefix is applied
    // per-command but SCAN's returned keys are full names, so managing the
    // del set with the prefix already on the connection is error-prone.
    const raw = new Redis(redisUrl);
    try {
      const stream = raw.scanStream({ match: pattern, count: 500 });
      const keys: string[] = [];
      for await (const batch of stream) keys.push(...batch);
      if (keys.length > 0) await raw.del(...keys);
    } finally {
      raw.disconnect();
    }
  }

  const flushNamespace = (): Promise<void> => deleteKeysMatching(`${prefix}*`);

  return {
    redis,
    redisUrl,
    keyPrefix: prefix,
    flushNamespace,
    cleanup: async () => {
      if (opts.borrowKeyPrefix !== undefined) {
        redis.disconnect();
        return;
      }
      await flushNamespace();
      // The derived per-stack JobRunner queues sit outside the keyPrefix.
      await deleteKeysMatching(`bull:${queueNamePrefixForTestRedis(prefix)}-*`);
      redis.disconnect();
    },
  };
}
