import { describe, expect, test } from "bun:test";
import { createLiveRefetchScheduler } from "../live-refetch-scheduler.ts";

describe("createLiveRefetchScheduler", () => {
  test("a failing run neither rejects unhandled nor drops the queued follow-up", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let runs = 0;
      let releaseFirst: () => void = () => {};
      const scheduler = createLiveRefetchScheduler(async () => {
        runs += 1;
        if (runs === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          throw new Error("load failed");
        }
      }, 1);
      scheduler.trigger();
      await Bun.sleep(10);
      expect(runs).toBe(1);
      // Event lands while the first run is in flight, then that run fails.
      scheduler.trigger();
      releaseFirst();
      await Bun.sleep(10);
      expect(runs).toBe(2);
      expect(unhandled).toEqual([]);
      scheduler.dispose();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
