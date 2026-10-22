export const LIVE_REFETCH_COALESCE_MS = 250;

export type LiveRefetchScheduler = {
  readonly trigger: () => void;
  readonly dispose: () => void;
};

// A burst of live events collapses into one trailing run. An event that lands
// while a run is still in flight queues exactly one follow-up after it.
export function createLiveRefetchScheduler(
  run: () => Promise<void> | void,
  windowMs: number = LIVE_REFETCH_COALESCE_MS,
): LiveRefetchScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let rerunQueued = false;
  let disposed = false;

  const fire = async (): Promise<void> => {
    timer = undefined;
    inFlight = true;
    try {
      await run();
    } catch {
      // The caller surfaces its own load errors in state; a failed run must
      // neither become an unhandled rejection nor drop the queued follow-up.
    } finally {
      inFlight = false;
    }
    if (rerunQueued && !disposed) {
      rerunQueued = false;
      await fire();
    }
  };

  return {
    trigger: () => {
      // skip: the subscriber is gone
      if (disposed) return;
      if (inFlight) {
        rerunQueued = true;
        // skip: the queued follow-up run covers this event
        return;
      }
      // skip: a trailing run is already scheduled and will cover this event
      if (timer !== undefined) return;
      timer = setTimeout(() => void fire(), windowMs);
    },
    dispose: () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
