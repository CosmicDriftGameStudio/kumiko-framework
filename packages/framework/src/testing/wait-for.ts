/**
 * Polls a condition with escalating timeouts.
 *
 * Default schedule: 250ms → 1s → 3s (3 attempts). Tries first, sleeps between
 * failures — already-true conditions return without waiting.
 * Throws the last assertion error if all attempts fail.
 *
 * Usage:
 *   await waitFor(() => {
 *     expect(events).toHaveLength(1);
 *   });
 */
export async function waitFor(
  fn: () => void | Promise<void>,
  options?: { delays?: number[] },
): Promise<void> {
  const delays = options?.delays ?? [250, 1000, 3000];
  if (delays.length === 0) {
    throw new Error("waitFor: empty delay schedule");
  }
  let lastError: unknown;

  for (let i = 0; i < delays.length; i++) {
    try {
      await fn();
      // skip: condition already true — no further polling
      return;
    } catch (err) {
      lastError = err;
    }
    if (i < delays.length - 1) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }

  throw lastError;
}
