import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

export type EntityCache = {
  /** Get a single cached entity. Returns null on miss. */
  get(tenantId: number, entityName: string, id: number): Promise<Record<string, unknown> | null>;

  /** Get multiple cached entities. Returns a Map of id → data (misses are absent). */
  mget(
    tenantId: number,
    entityName: string,
    ids: readonly number[],
  ): Promise<Map<number, Record<string, unknown>>>;

  /** Cache a single entity. */
  set(
    tenantId: number,
    entityName: string,
    id: number,
    data: Record<string, unknown>,
  ): Promise<void>;

  /** Cache multiple entities at once. */
  mset(
    tenantId: number,
    entityName: string,
    entries: ReadonlyArray<{ id: number; data: Record<string, unknown> }>,
  ): Promise<void>;

  /** Invalidate a single cached entity. */
  del(tenantId: number, entityName: string, id: number): Promise<void>;
};

export type EntityCacheOptions = {
  ttlSeconds?: number;
};

export function createEntityCache(redis: Redis, options: EntityCacheOptions = {}): EntityCache {
  const ttl = options.ttlSeconds ?? 300;
  const prefix = RedisKeys.entityCache;

  function cacheKey(tenantId: number, entityName: string, id: number): string {
    return `${prefix}${tenantId}:${entityName}:${id}`;
  }

  return {
    async get(tenantId, entityName, id) {
      const raw = await redis.get(cacheKey(tenantId, entityName, id));
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    },

    async mget(tenantId, entityName, ids) {
      if (ids.length === 0) return new Map();
      const keys = ids.map((id) => cacheKey(tenantId, entityName, id));
      const values = await redis.mget(...keys);

      const result = new Map<number, Record<string, unknown>>();
      for (let i = 0; i < ids.length; i++) {
        const raw = values[i];
        if (raw) {
          result.set(ids[i] as number, JSON.parse(raw) as Record<string, unknown>);
        }
      }
      return result;
    },

    async set(tenantId, entityName, id, data) {
      await redis.set(cacheKey(tenantId, entityName, id), JSON.stringify(data), "EX", ttl);
    },

    async mset(tenantId, entityName, entries) {
      if (entries.length === 0) return;
      const pipe = redis.pipeline();
      for (const entry of entries) {
        pipe.set(cacheKey(tenantId, entityName, entry.id), JSON.stringify(entry.data), "EX", ttl);
      }
      await pipe.exec();
    },

    async del(tenantId, entityName, id) {
      await redis.del(cacheKey(tenantId, entityName, id));
    },
  };
}
