import type Redis from "ioredis";
import { generateId } from "../utils";
import { RedisKeys } from "./redis-keys";

export type DistributedLock = {
  acquire(key: string, options?: { ttlSeconds?: number }): Promise<string | null>;
  release(key: string, token: string): Promise<boolean>;
  /** Extends the TTL of a lock this caller still holds (token matches).
   *  Returns false when the token doesn't match — expired and re-claimed
   *  by someone else, or never held — the caller must treat that as
   *  "no longer the owner" and stop renewing, not retry. */
  renew(key: string, token: string, ttlSeconds: number): Promise<boolean>;
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

  // Lua script for atomic check-and-extend — same ownership check as release,
  // but resets the TTL instead of deleting the key.
  const renewScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("expire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  return {
    async acquire(key, options = {}) {
      const ttl = options.ttlSeconds ?? 30;
      const token = generateId();
      const result = await redis.set(`${prefix}${key}`, token, "EX", ttl, "NX");
      return result === "OK" ? token : null;
    },

    async release(key, token) {
      // Atomic: only release if we own the lock (compare token via Lua)
      const result = (await redis.eval(releaseScript, 1, `${prefix}${key}`, token)) as number; // @cast-boundary db-operator
      return result === 1;
    },

    async renew(key, token, ttlSeconds) {
      const result = (await redis.eval(
        renewScript,
        1,
        `${prefix}${key}`,
        token,
        String(ttlSeconds),
      )) as number; // @cast-boundary db-operator
      return result === 1;
    },
  };
}
