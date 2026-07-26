// Bounded-concurrency map — runs `fn` over `items` with at most `limit`
// calls in flight. `Promise.all(items.map(fn))` is unbounded (as many
// calls as rows); a plain sequential loop caps concurrency at 1, which
// under-uses a resource pool that allows more (e.g. PgKmsAdapter's
// default `max: 4` — sequential decrypt-per-row leaves 3 pool slots idle
// and turns each query into 2N serial round-trips instead of ~2N/4).
// Order of `results` matches `items`, independent of completion order.
// On rejection: the returned promise rejects with the first error, and
// remaining workers stop claiming new items (`failed` flag). In-flight
// calls already past the claim still run to completion (their promises
// stay in the `Promise.all` array, so a later rejection can't surface as
// an unhandled rejection — verified in `mapWithConcurrency.test.ts`).
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failed = false;
  async function worker(): Promise<void> {
    for (;;) {
      if (failed) return;
      const index = nextIndex++;
      // skip: cursor exhausted, normal worker-loop exit
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
