import type Redis from "ioredis";
import { v4 as uuid } from "uuid";
import { RedisKeys } from "./redis-keys";

export type DistributedLock = {
  acquire(key: string, options?: { ttlSeconds?: number }): Promise<string | null>;
  release(key: string, token: string): Promise<boolean>;
};

export function createDistributedLock(
  redis: Redis,
  prefix: string = RedisKeys.lock,
): DistributedLock {
  // Lua script for atomic check-and-delete (safe Redis server-side eval, not JS eval)
  const releaseScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  return {
    async acquire(key, options = {}) {
      const ttl = options.ttlSeconds ?? 30;
      const token = uuid();
      const result = await redis.set(`${prefix}${key}`, token, "EX", ttl, "NX");
      return result === "OK" ? token : null;
    },

    async release(key, token) {
      // Atomic: only release if we own the lock (compare token via Lua)
      const result = (await redis.eval(releaseScript, 1, `${prefix}${key}`, token)) as number;
      return result === 1;
    },
  };
}
