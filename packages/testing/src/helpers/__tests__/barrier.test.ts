import { describe, expect, test } from "bun:test";
import { createBarrier } from "../barrier.ts";

describe("createBarrier", () => {
  test("opens only once all expected calls arrived", async () => {
    const barrier = createBarrier({ expected: 2 });
    const first = barrier.arrive();
    let opened = false;
    void first.then(() => {
      opened = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toBe(false);
    const second = barrier.arrive();
    await Promise.all([first, second]);
    expect(opened).toBe(true);
    expect(barrier.arrived).toBe(2);
  });

  test("a skip counts toward opening", async () => {
    const barrier = createBarrier({ expected: 2 });
    const first = barrier.arrive();
    barrier.skip();
    await first;
    expect(barrier.skipped).toBe(1);
    expect(barrier.arrived).toBe(1);
  });

  test("rejects waiting calls with the arrival count after the timeout", async () => {
    const barrier = createBarrier({ expected: 2, timeoutMs: 10 });
    await expect(barrier.arrive()).rejects.toThrow(/1 of 2/);
  });

  test("a call arriving after the timeout rejects instead of hanging", async () => {
    const barrier = createBarrier({ expected: 3, timeoutMs: 10 });
    await expect(barrier.arrive()).rejects.toThrow(/barrier timed out/);
    await expect(barrier.arrive()).rejects.toThrow(/barrier timed out/);
  });

  test("throws when expected is below 1", () => {
    expect(() => createBarrier({ expected: 0 })).toThrow();
  });
});
