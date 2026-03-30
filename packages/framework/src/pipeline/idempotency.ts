import type Redis from "ioredis";

export type IdempotencyGuard = {
  check(requestId: string): Promise<string | null>;
  store(requestId: string, result: unknown): Promise<void>;
};

export function createIdempotencyGuard(
  redis: Redis,
  options: { ttlSeconds?: number } = {},
): IdempotencyGuard {
  const ttl = options.ttlSeconds ?? 300;
  const prefix = "kumiko:idempotency:";

  return {
    async check(requestId) {
      const cached = await redis.get(`${prefix}${requestId}`);
      return cached;
    },

    async store(requestId, result) {
      await redis.set(`${prefix}${requestId}`, JSON.stringify(result), "EX", ttl);
    },
  };
}
