// Bounded-concurrency map — runs `fn` over `items` with at most `limit`
// calls in flight. `Promise.all(items.map(fn))` is unbounded (as many
// calls as rows); a plain sequential loop caps concurrency at 1, which
// under-uses a resource pool that allows more (e.g. PgKmsAdapter's
// default `max: 4` — sequential decrypt-per-row leaves 3 pool slots idle
// and turns each query into 2N serial round-trips instead of ~2N/4).
// Order of `results` matches `items`, independent of completion order.
// On rejection: the returned promise rejects with the first error, but
// in-flight workers other than the one that threw keep running to
// completion (unlike a sequential loop, which stops at the first error).
// Fine for a read path like PII decrypt where results are discarded on
// failure anyway. No unhandled-rejection risk from a second/third worker
// rejecting after the first: every worker promise is an element of the
// `Promise.all` array below, so each one always has a handler attached
// regardless of when it settles (verified: two workers rejecting at
// different times below, `mapWithConcurrency.test.ts`).
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return; // skip: cursor exhausted, normal worker-loop exit
      results[index] = await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
