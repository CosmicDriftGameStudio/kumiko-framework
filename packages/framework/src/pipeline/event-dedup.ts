import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

export type EventDedup = {
  /**
   * Atomically try to acquire processing rights for an eventId.
   * Returns true if this is the first call (proceed), false if already processed (skip).
   */
  tryAcquire(eventId: string): Promise<boolean>;
};

export function createEventDedup(redis: Redis, options: { ttlSeconds?: number } = {}): EventDedup {
  const ttl = options.ttlSeconds ?? 300;
  const prefix = RedisKeys.eventDedup;

  return {
    async tryAcquire(eventId) {
      // SET NX = atomic check-and-set: only succeeds if key does not exist
      const result = await redis.set(`${prefix}${eventId}`, "1", "EX", ttl, "NX");
      return result === "OK";
    },
  };
}
