export type LruCacheOptions<V> = {
  readonly maxEntries: number;
  /** Entries at least this old count as misses; omitted = no expiry. */
  readonly ttlMs?: number;
  readonly now?: () => number;
  /** Summed `sizeOf` budget; a value larger than the whole budget is never cached. */
  readonly maxTotalSize?: number;
  readonly sizeOf?: (value: V) => number;
};

export type LruCache<K, V> = {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  clear(): void;
  readonly size: number;
};

type Stored<V> = { readonly value: V; readonly storedAt: number; readonly size: number };

// Map iteration is insertion order: re-inserting on a hit keeps the most recently used entry last.
export function createLruCache<K, V>(options: LruCacheOptions<V>): LruCache<K, V> {
  const now = options.now ?? Date.now;
  const sizeOf = options.sizeOf ?? (() => 0);
  const entries = new Map<K, Stored<V>>();
  let totalSize = 0;

  function remove(key: K): void {
    const stored = entries.get(key);
    // skip: key not cached, nothing to remove
    if (stored === undefined) return;
    totalSize -= stored.size;
    entries.delete(key);
  }

  function overBudget(): boolean {
    if (entries.size > options.maxEntries) return true;
    return options.maxTotalSize !== undefined && totalSize > options.maxTotalSize;
  }

  return {
    get(key) {
      const hit = entries.get(key);
      if (hit === undefined) return undefined;
      remove(key);
      if (options.ttlMs !== undefined && now() - hit.storedAt >= options.ttlMs) return undefined;
      entries.set(key, hit);
      totalSize += hit.size;
      return hit.value;
    },
    set(key, value) {
      remove(key);
      const size = sizeOf(value);
      // skip: a value larger than the whole budget would evict everything and still not fit
      if (options.maxTotalSize !== undefined && size > options.maxTotalSize) return;
      entries.set(key, { value, storedAt: now(), size });
      totalSize += size;
      while (overBudget()) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        remove(oldest.value);
      }
    },
    delete: remove,
    clear() {
      entries.clear();
      totalSize = 0;
    },
    get size() {
      return entries.size;
    },
  };
}
