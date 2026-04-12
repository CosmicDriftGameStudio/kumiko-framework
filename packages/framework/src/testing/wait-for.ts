/**
 * Polls a condition with escalating timeouts.
 *
 * Default schedule: 250ms → 1s → 3s (3 attempts).
 * Returns immediately on success. Throws the last assertion error if all attempts fail.
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
  let lastError: unknown;

  for (let i = 0; i < delays.length; i++) {
    await new Promise((r) => setTimeout(r, delays[i]));
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}
