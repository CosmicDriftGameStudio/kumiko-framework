export type Barrier = {
  readonly arrive: () => Promise<void>;
  readonly skip: () => void;
  readonly arrived: number;
  readonly skipped: number;
};

const DEFAULT_BARRIER_TIMEOUT_MS = 5000;

export function createBarrier(options: {
  readonly expected: number;
  readonly timeoutMs?: number;
}): Barrier {
  const { expected, timeoutMs = DEFAULT_BARRIER_TIMEOUT_MS } = options;
  if (expected < 1) {
    throw new Error(`barrier expected must be at least 1, got ${expected}`);
  }

  let arrived = 0;
  let skipped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];

  function openIfComplete(): void {
    if (arrived + skipped >= expected) {
      clearTimeout(timer);
      for (const waiter of waiting.splice(0)) waiter.resolve();
    }
  }

  return {
    arrive() {
      arrived++;
      const pending = new Promise<void>((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
      if (arrived === 1 && arrived + skipped < expected) {
        timer = setTimeout(() => {
          const error = new Error(
            `barrier timed out: ${arrived} of ${expected} arrived, ${skipped} skipped`,
          );
          for (const waiter of waiting.splice(0)) waiter.reject(error);
        }, timeoutMs);
      }
      openIfComplete();
      return pending;
    },
    skip() {
      skipped++;
      openIfComplete();
    },
    get arrived() {
      return arrived;
    },
    get skipped() {
      return skipped;
    },
  };
}
