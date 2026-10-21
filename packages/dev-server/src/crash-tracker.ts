// Tracks server crashes in a rolling time window and decides whether the dev wrapper may respawn or must stop the crash loop.
// It lives in a separate file so `kumiko-dev.ts` (a bin script without test setup) has a pure, injectable API; the logic can be tested via createCrashTracker without running the wrapper process.
//
// A crash counts as being in the window if it was registered within the last `windowMs` ms before `now`. If, after recording the new crash, more than `maxCrashes` are in the window, the tracker returns `false`, so the wrapper must stop.

export type CrashTrackerOptions = {
  readonly maxCrashes: number;
  readonly windowMs: number;
};

export type CrashTracker = {
  /** Registers a crash at `now`. Returns `true` if the wrapper may still respawn and `false` if the limit has been exceeded.
   *
   * The crash is always recorded, even when `false` is returned; the caller normally terminates in that case anyway. Reuse with "rejected → state unchanged" semantics is not supported. */
  readonly noteCrash: (now: number) => boolean;
  /** Counts crashes in the window relative to `now`. Prunes lazily so the call is consistent even without a preceding noteCrash. */
  readonly crashCountInWindow: (now: number) => number;
};

export function createCrashTracker(options: CrashTrackerOptions): CrashTracker {
  const timestamps: number[] = [];

  const pruneBefore = (cutoff: number): void => {
    // Removes crashes older than `cutoff`. A timestamp equal to cutoff remains (`<` rather than `<=`) to match the window definition "within the last windowMs", whose endpoint is inclusive.
    while (timestamps.length > 0) {
      const head = timestamps[0];
      if (head !== undefined && head < cutoff) timestamps.shift();
      else break;
    }
  };

  return {
    noteCrash: (now) => {
      pruneBefore(now - options.windowMs);
      timestamps.push(now);
      return timestamps.length <= options.maxCrashes;
    },
    crashCountInWindow: (now) => {
      pruneBefore(now - options.windowMs);
      return timestamps.length;
    },
  };
}
