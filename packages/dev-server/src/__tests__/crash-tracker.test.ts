// Unit tests for createCrashTracker — the rolling-window logic from
// kumiko-dev. This covers the crash-loop protection that decides whether
// the wrapper gives up or respawns another round; an off-by-one at the
// window boundary would be difficult to detect in the bin script.

import { describe, expect, test } from "bun:test";
import { createCrashTracker } from "../crash-tracker.ts";

describe("createCrashTracker", () => {
  test("The first maxCrashes crashes are allowed, but the next one is not", () => {
    const t = createCrashTracker({ maxCrashes: 3, windowMs: 10_000 });
    expect(t.noteCrash(1000)).toBe(true);
    expect(t.noteCrash(1100)).toBe(true);
    expect(t.noteCrash(1200)).toBe(true);
    // Fourth crash within the window → over the limit
    expect(t.noteCrash(1300)).toBe(false);
  });

  test("Old crashes outside the window are pruned", () => {
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(500);
    // At t=1500, t=0 is out (1500 - 1000 = 500; everything < 500 is
    // removed), so only t=500 remains in the window. With the new crash at
    // 1500, the count is 2 → still within the limit.
    expect(t.noteCrash(1500)).toBe(true);
    expect(t.crashCountInWindow(1500)).toBe(2);
  });

  test("crashCountInWindow counts only crashes within the window", () => {
    const t = createCrashTracker({ maxCrashes: 5, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(0);
    t.noteCrash(2000); // pruned beide alten weg
    expect(t.crashCountInWindow(2000)).toBe(1);
  });

  test("crashCountInWindow also prunes lazily without a previous noteCrash", () => {
    // Important: crashCountInWindow must be correct independently, not only
    // as a consequence of a previous noteCrash. Otherwise its name is misleading.
    const t = createCrashTracker({ maxCrashes: 5, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(100);
    // Direct call at now=2000 — all old crashes have expired.
    expect(t.crashCountInWindow(2000)).toBe(0);
    // Idempotent: the second call returns the same result.
    expect(t.crashCountInWindow(2000)).toBe(0);
  });

  test("Boundary: A crash exactly at the window endpoint remains in the window", () => {
    // Inclusive endpoint: cutoff = now - windowMs. A crash at t=cutoff
    // must still count. Here: now=1000, windowMs=1000 → cutoff=0.
    // A previous crash at t=0 must not be pruned as old.
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    t.noteCrash(0);
    expect(t.noteCrash(1000)).toBe(true);
    expect(t.crashCountInWindow(1000)).toBe(2);
    // Third crash at 1000 → 3 in the window, over the limit
    expect(t.noteCrash(1000)).toBe(false);
  });

  test("Multiple crashes at the same timestamp are counted individually", () => {
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    expect(t.noteCrash(500)).toBe(true);
    expect(t.noteCrash(500)).toBe(true);
    expect(t.noteCrash(500)).toBe(false);
  });

  test("After waiting > windowMs, the limit is reset", () => {
    const t = createCrashTracker({ maxCrashes: 2, windowMs: 1000 });
    t.noteCrash(0);
    t.noteCrash(100);
    expect(t.noteCrash(200)).toBe(false); // over the limit
    // Wartezeit, alte Crashes raus
    expect(t.noteCrash(2000)).toBe(true);
    expect(t.crashCountInWindow(2000)).toBe(1);
  });

  test("maxCrashes=1 allows exactly one crash per window", () => {
    const t = createCrashTracker({ maxCrashes: 1, windowMs: 1000 });
    expect(t.noteCrash(0)).toBe(true);
    expect(t.noteCrash(500)).toBe(false);
    // At t=1600, both previous crashes (0 and 500) are outside the window
    // (cutoff = 600, 0 < 600 and 500 < 600), so the tracker is empty
    // before the new crash is pushed.
    expect(t.noteCrash(1600)).toBe(true);
    expect(t.crashCountInWindow(1600)).toBe(1);
  });
});
