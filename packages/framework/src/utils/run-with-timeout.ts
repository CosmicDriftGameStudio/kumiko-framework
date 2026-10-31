class TimeoutError extends Error {}

export type TimedRunResult<T> =
  | { readonly ok: true; readonly value: T; readonly latencyMs: number }
  | {
      readonly ok: false;
      readonly error: unknown;
      readonly timedOut: boolean;
      readonly latencyMs: number;
    };

export async function runWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<TimedRunResult<T>> {
  const start = performance.now();
  const elapsedMs = () => Math.round(performance.now() - start);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
        // Don't keep the event loop alive on a hung run during shutdown.
        timer.unref?.();
      }),
    ]);
    return { ok: true, value, latencyMs: elapsedMs() };
  } catch (error) {
    return {
      ok: false,
      error,
      timedOut: error instanceof TimeoutError,
      latencyMs: elapsedMs(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
