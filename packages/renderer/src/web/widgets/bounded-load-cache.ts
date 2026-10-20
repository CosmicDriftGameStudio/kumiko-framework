// Evicts the oldest entry once `max` is exceeded and disposes only that one,
// so several documents on one page keep their own loading tasks alive.
export function createBoundedLoadCache<T>(
  max: number,
  dispose: (value: T) => void,
): (key: string, load: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, Promise<T>>();
  return (key, load) => {
    const cached = entries.get(key);
    if (cached !== undefined) return cached;
    const loading = load();
    entries.set(key, loading);
    // A failed load must not stick: the next mount retries instead of replaying the rejection.
    loading.catch(() => {
      if (entries.get(key) === loading) entries.delete(key);
    });
    if (entries.size > max) {
      const [oldestKey, oldest] = entries.entries().next().value ?? [];
      if (oldestKey !== undefined && oldest !== undefined) {
        entries.delete(oldestKey);
        void oldest.then(dispose);
      }
    }
    return loading;
  };
}
