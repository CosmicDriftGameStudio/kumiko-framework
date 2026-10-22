// Evicts the oldest idle entry once `max` is exceeded and disposes only that one, so several
// documents on one page keep their own loading tasks alive. Consumers hold an entry through
// `retain`; a held entry is never evicted (the cache may exceed `max` while entries are in use).
// A consumer only retains after it mounted, so an entry nobody has held yet is still being
// handed to its first consumers and is spared until the cache reaches twice `max`. A resolved
// value that `shouldKeep` rejects (a handled failure) is dropped so the next mount retries.
export type BoundedLoadCache<T> = {
  readonly load: (key: string, load: () => Promise<T>) => Promise<T>;
  // Returns the release function.
  readonly retain: (key: string) => () => void;
};

export function createBoundedLoadCache<T>(
  max: number,
  dispose: (value: T) => void,
  shouldKeep: (value: T) => boolean = () => true,
): BoundedLoadCache<T> {
  const entries = new Map<string, Promise<T>>();
  const users = new Map<string, number>();
  const everRetained = new Set<string>();

  const evictIdle = (protectedKey?: string): void => {
    for (const [key, entry] of entries) {
      if (entries.size <= max) return;
      const idle = (users.get(key) ?? 0) === 0;
      const settled = everRetained.has(key) || entries.size > max * 2;
      if (key === protectedKey || !idle || !settled) continue;
      entries.delete(key);
      everRetained.delete(key);
      void entry.then(dispose);
    }
  };

  return {
    load: (key, load) => {
      const cached = entries.get(key);
      if (cached !== undefined) return cached;
      const loading = load();
      entries.set(key, loading);
      // A failed load must not stick: the next mount retries instead of replaying the rejection.
      const forget = (): void => {
        if (entries.get(key) === loading) entries.delete(key);
      };
      loading.then((value) => {
        if (!shouldKeep(value)) forget();
      }, forget);
      evictIdle(key);
      return loading;
    },
    retain: (key) => {
      users.set(key, (users.get(key) ?? 0) + 1);
      everRetained.add(key);
      return () => {
        const remaining = (users.get(key) ?? 1) - 1;
        if (remaining > 0) {
          users.set(key, remaining);
          return;
        }
        users.delete(key);
        evictIdle();
      };
    },
  };
}
