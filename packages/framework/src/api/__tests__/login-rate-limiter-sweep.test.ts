import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createInMemoryLoginRateLimiter } from "../auth-routes.ts";

describe("createInMemoryLoginRateLimiter — sweep + cap", () => {
  test("sweepExpired removes expired entries before enforceCap can evict a fresh key", async () => {
    // maxAttempts=1 makes every entry a single-shot probe: a second `check`
    // on the same key only returns true if the entry was actually removed
    // from the map (either by expiry+sweep or by enforceCap).
    const limiter = createInMemoryLoginRateLimiter(1, 50, {
      maxEntries: 2,
      sweepThreshold: 2,
    });

    expect(await limiter.check("old1")).toBe(true);
    expect(await limiter.check("old2")).toBe(true);
    // Let both windows expire.
    await Bun.sleep(60);

    // hits.size (2) >= sweepThreshold (2) → sweepExpired runs first and
    // clears old1/old2 before "new1" is inserted, so enforceCap never fires.
    expect(await limiter.check("new1")).toBe(true);
    expect(await limiter.check("new2")).toBe(true);

    // If enforceCap had run instead of (or before) the sweep, it would have
    // evicted "new1" as the oldest live entry, and this check would return
    // true (fresh window) rather than false (still rate-limited).
    expect(await limiter.check("new1")).toBe(false);
  });

  test("enforceCap drops the oldest entry when the map exceeds maxEntries", async () => {
    const limiter = createInMemoryLoginRateLimiter(1, 60_000, {
      maxEntries: 3,
      sweepThreshold: 10_000, // never sweep — only the hard cap matters
    });

    expect(await limiter.check("k1")).toBe(true);
    expect(await limiter.check("k2")).toBe(true);
    expect(await limiter.check("k3")).toBe(true);
    // 4th insert trips enforceCap → drops the oldest entry (k1).
    expect(await limiter.check("k4")).toBe(true);

    // k1 was dropped — a fresh check starts a new window (allowed).
    expect(await limiter.check("k1")).toBe(true);

    // k4 must still be alive in the map: a check within its still-open
    // window is rate-limited (count >= maxAttempts), proving enforceCap
    // dropped k1 and not k4.
    expect(await limiter.check("k4")).toBe(false);
  });
});

describe("createInMemoryLoginRateLimiter — refund", () => {
  test("gives back one reserved slot", async () => {
    const limiter = createInMemoryLoginRateLimiter(1, 60_000);
    expect(await limiter.check("k")).toBe(true);
    expect(await limiter.check("k")).toBe(false);
    await limiter.refund?.("k");
    expect(await limiter.check("k")).toBe(true);
    expect(await limiter.check("k")).toBe(false);
  });

  test("on an unknown key it changes nothing", async () => {
    const limiter = createInMemoryLoginRateLimiter(1, 60_000);
    await limiter.refund?.("unknown");
    expect(await limiter.check("unknown")).toBe(true);
    expect(await limiter.check("unknown")).toBe(false);
  });

  test("at count zero it does not go negative", async () => {
    const limiter = createInMemoryLoginRateLimiter(1, 60_000);
    await limiter.check("k");
    await limiter.refund?.("k");
    await limiter.refund?.("k");
    expect(await limiter.check("k")).toBe(true);
    expect(await limiter.check("k")).toBe(false);
  });

  describe("with a controlled clock", () => {
    afterEach(() => setSystemTime());

    test("after the window expired it neither extends the entry nor creates a new one", async () => {
      setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const limiter = createInMemoryLoginRateLimiter(2, 1_000);
      await limiter.check("k");
      await limiter.check("k");
      setSystemTime(new Date("2026-01-01T00:00:02Z"));
      await limiter.refund?.("k");
      // Fresh window: a refund must not have left a stale or pre-decremented entry behind.
      expect(await limiter.check("k")).toBe(true);
      expect(await limiter.check("k")).toBe(true);
      expect(await limiter.check("k")).toBe(false);
    });
  });
});
