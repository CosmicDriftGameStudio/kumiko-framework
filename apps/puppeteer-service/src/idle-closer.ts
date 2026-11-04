// Counts running renders and fires `close` once none has run for the idle
// period. The timer is injectable so tests need neither real time nor Chromium.

export type StartTimer = (fn: () => void, ms: number) => () => void;

// unref: a pending idle timer must never keep the process alive on shutdown.
const startRealTimer: StartTimer = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return () => clearTimeout(handle);
};

export type IdleCloser = {
  /** Call before anything that needs the resource (also before launching it). */
  begin(): void;
  /** Call after the render finished; arms the idle timer when it was the last one. */
  end(idleMs: number): void;
  cancel(): void;
};

export function createIdleCloser(
  close: () => void,
  startTimer: StartTimer = startRealTimer,
): IdleCloser {
  let running = 0;
  let cancelTimer: (() => void) | null = null;

  const cancel = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };

  return {
    begin() {
      cancel();
      running += 1;
    },
    end(idleMs) {
      running -= 1;
      if (running > 0) return;
      cancel();
      cancelTimer = startTimer(() => {
        cancelTimer = null;
        if (running === 0) close();
      }, idleMs);
    },
    cancel,
  };
}
