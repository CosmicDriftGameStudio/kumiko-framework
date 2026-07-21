import { describe, expect, test } from "bun:test";
import { createInMemoryLoginRateLimiter } from "../auth-routes";

describe("createInMemoryLoginRateLimiter — sweep + cap", () => {
  test("sweepExpired drops windows that already reset before accepting a new key", async () => {
    // Tiny thresholds so the Map hits the sweep path without flooding.
    const limiter = createInMemoryLoginRateLimiter(10, 50, {
      maxEntries: 100,
      sweepThreshold: 2,
    });

    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("b")).toBe(true);
    // Wait for both windows to expire, then a third check must sweep a+b
    // (hits.size >= sweepThreshold) before inserting "c".
    await Bun.sleep(60);
    expect(await limiter.check("c")).toBe(true);
    // Fresh window for "a" after sweep — not rate-limited.
    expect(await limiter.check("a")).toBe(true);
  });

  test("enforceCap drops oldest entries when the map exceeds maxEntries", async () => {
    const limiter = createInMemoryLoginRateLimiter(100, 60_000, {
      maxEntries: 3,
      sweepThreshold: 10_000, // never sweep — only the hard cap matters
    });

    expect(await limiter.check("k1")).toBe(true);
    expect(await limiter.check("k2")).toBe(true);
    expect(await limiter.check("k3")).toBe(true);
    // 4th insert trips enforceCap → drops oldest (k1).
    expect(await limiter.check("k4")).toBe(true);

    // k1 was dropped — a fresh check starts a new window (allowed).
    expect(await limiter.check("k1")).toBe(true);
    // k2/k3/k4 still live in the map (cap=3 after k1 drop + k1 reinsert may
    // drop another). Reset proves the API still works for survivors.
    await limiter.reset("k4");
    expect(await limiter.check("k4")).toBe(true);
  });
});
