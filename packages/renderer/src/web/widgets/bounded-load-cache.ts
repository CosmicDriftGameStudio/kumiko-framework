// Evicts the oldest entry once `max` is exceeded and disposes only that one,
// so several documents on one page keep their own loading tasks alive. A
// resolved value that `shouldKeep` rejects (a handled failure) is dropped so
// the next mount retries.
export function createBoundedLoadCache<T>(
  max: number,
  dispose: (value: T) => void,
  shouldKeep: (value: T) => boolean = () => true,
): (key: string, load: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, Promise<T>>();
  return (key, load) => {
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
