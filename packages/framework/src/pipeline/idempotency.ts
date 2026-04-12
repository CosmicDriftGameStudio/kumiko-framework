import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

export type IdempotencyGuard = {
  check(requestId: string): Promise<string | null>;
  store(requestId: string, result: unknown): Promise<void>;
};

export function createIdempotencyGuard(
  redis: Redis,
  options: { ttlSeconds?: number } = {},
): IdempotencyGuard {
  const ttl = options.ttlSeconds ?? 300;
  const prefix = RedisKeys.idempotency;

  return {
    async check(requestId) {
      return redis.get(`${prefix}${requestId}`);
    },

    async store(requestId, result) {
      // SET NX: only store if not already stored (atomic, prevents race between concurrent requests)
      await redis.set(`${prefix}${requestId}`, JSON.stringify(result), "EX", ttl, "NX");
    },
  };
}
