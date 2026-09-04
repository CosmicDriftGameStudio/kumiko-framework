/**
 * Polls a condition with escalating timeouts.
 *
 * Default schedule: 250ms → 1s → 3s between attempts. Tries first (already-true
 * returns immediately), then sleeps `delays[i]` after each failure before the
 * next try — so N delays yield N+1 attempts and the full backoff budget.
 * Throws the last assertion error if all attempts fail.
 *
 * Usage (assertion form):
 *   await waitFor(() => {
 *     expect(events).toHaveLength(1);
 *   });
 *
 * Usage (predicate form — a literal `false` return means "not yet", anything
 * else, including `undefined`, counts as success):
 *   await waitFor(() => events.length >= 4);
 */
export async function waitFor(
  fn: () => void | boolean | Promise<void | boolean>,
  options?: { delays?: number[] },
): Promise<void> {
  const delays = options?.delays ?? [250, 1000, 3000];
  if (delays.length === 0) {
    throw new Error("waitFor: empty delay schedule");
  }
  let lastError: unknown;

  for (let i = 0; ; i++) {
    try {
      const result = await fn();
      if (result !== false) {
        // skip: condition already true — no further polling
        return;
      }
    } catch (err) {
      lastError = err;
    }
    if (i >= delays.length) {
      break;
    }
    await new Promise((r) => setTimeout(r, delays[i]));
  }

  if (lastError !== undefined) {
    throw lastError;
  }
  throw new Error("waitFor: condition never became true within the delay schedule");
}
