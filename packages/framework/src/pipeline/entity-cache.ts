import type { EntityId, TenantId } from "@kumiko/framework/engine";
import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

// JSON.stringify turns Date into an ISO string, but DB reads return Date
// objects. Without a reviver the cache path would yield strings where the
// DB path yields Dates — consumers would silently see a type mismatch.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

function parseCached(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw, dateReviver) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export type EntityCache = {
  /** Get a single cached entity. Returns null on miss. */
  get(
    tenantId: TenantId,
    entityName: string,
    id: EntityId,
  ): Promise<Record<string, unknown> | null>;

  /** Get multiple cached entities. Returns a Map of id → data (misses are absent). */
  mget(
    tenantId: TenantId,
    entityName: string,
    ids: readonly EntityId[],
  ): Promise<Map<EntityId, Record<string, unknown>>>;

  /** Cache a single entity. */
  set(
    tenantId: TenantId,
    entityName: string,
    id: EntityId,
    data: Record<string, unknown>,
  ): Promise<void>;

  /** Cache multiple entities at once. */
  mset(
    tenantId: TenantId,
    entityName: string,
    entries: ReadonlyArray<{ id: EntityId; data: Record<string, unknown> }>,
  ): Promise<void>;

  /** Invalidate a single cached entity. */
  del(tenantId: TenantId, entityName: string, id: EntityId): Promise<void>;
};

export type EntityCacheOptions = {
  ttlSeconds?: number;
};

export function createEntityCache(redis: Redis, options: EntityCacheOptions = {}): EntityCache {
  const ttl = options.ttlSeconds ?? 300;
  const prefix = RedisKeys.entityCache;

  function cacheKey(tenantId: TenantId, entityName: string, id: EntityId): string {
    return `${prefix}${tenantId}:${entityName}:${id}`;
  }

  return {
    async get(tenantId, entityName, id) {
      const raw = await redis.get(cacheKey(tenantId, entityName, id));
      if (!raw) return null;
      return parseCached(raw);
    },

    async mget(tenantId, entityName, ids) {
      if (ids.length === 0) return new Map();
      const keys = ids.map((id) => cacheKey(tenantId, entityName, id));
      const values = await redis.mget(...keys);

      const result = new Map<EntityId, Record<string, unknown>>();
      for (let i = 0; i < ids.length; i++) {
        const raw = values[i];
        if (raw) {
          const parsed = parseCached(raw);
          if (parsed) result.set(ids[i] as EntityId, parsed);
        }
      }
      return result;
    },

    async set(tenantId, entityName, id, data) {
      await redis.set(cacheKey(tenantId, entityName, id), JSON.stringify(data), "EX", ttl);
    },

    async mset(tenantId, entityName, entries) {
      // skip: empty batch, nothing to cache
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
