// Per-dispatcher in-process cache for the resolved tenant:config:timezone
// value (fw#2462). dispatch-shared.ts's buildHandlerContext resolves that
// key on every dispatch to build ctx.tz — without a cache that's a config
// SELECT (sometimes two, cascade + fallback) per request, often inside an
// open write transaction. A tenant-keyed TTL cache removes the steady-state
// cost; dispatch-write.ts invalidates entries synchronously on
// config:write:set/reset for this key, so the TTL below only covers writes
// that bypass that path (migrations, seeds, direct DB edits).

import type { TenantId } from "../engine/types/identifiers";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

export type TenantTimezoneCacheOptions = {
  readonly ttlMs?: number;
  // Cap on distinct tenants cached. On overflow, least-recently-used
  // entries are evicted — mirrors secrets/dek-cache.ts.
  readonly maxEntries?: number;
  readonly now?: () => number;
};

export type TenantTimezoneCacheEntry = {
  // The raw resolved config value, or undefined when the tenant has no
  // override — undefined here is a cached fact ("looked up, no value"),
  // distinct from a cache miss (get() returning undefined below).
  readonly value: string | undefined;
};

export type TenantTimezoneCache = {
  // Returns undefined on a cache miss (never looked up, or expired).
  get(tenantId: TenantId): TenantTimezoneCacheEntry | undefined;
  set(tenantId: TenantId, value: string | undefined): void;
  invalidate(tenantId: TenantId): void;
  // Drops every tenant's entry — used when a system-scope write changes
  // the key, since the system row is the fallback default for every
  // tenant without its own override (a system-scope change can affect
  // all of them at once).
  clear(): void;
  size(): number;
};

export function createTenantTimezoneCache(
  opts: TenantTimezoneCacheOptions = {},
): TenantTimezoneCache {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = opts.now ?? (() => Date.now());
  // Map insertion order doubles as LRU order: touch = delete+re-insert.
  const entries = new Map<TenantId, { value: string | undefined; expiresAt: number }>();

  function evictOldestIfFull(): void {
    // skip: cache has room, nothing to evict
    if (entries.size < maxEntries) return;
    const oldestKey = entries.keys().next().value;
    // skip: defensive — only reachable if maxEntries is 0 (cache disabled) and entries is empty
    if (oldestKey === undefined) return;
    entries.delete(oldestKey);
  }

  return {
    get(tenantId) {
      const hit = entries.get(tenantId);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        entries.delete(tenantId);
        return undefined;
      }
      entries.delete(tenantId);
      entries.set(tenantId, hit);
      return { value: hit.value };
    },

    set(tenantId, value) {
      entries.delete(tenantId);
      evictOldestIfFull();
      entries.set(tenantId, { value, expiresAt: now() + ttlMs });
    },

    invalidate(tenantId) {
      entries.delete(tenantId);
    },

    clear() {
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}
