import { describe, expect, test } from "bun:test";
import { createBarrier } from "../barrier.ts";

describe("createBarrier", () => {
  test("opens only once all expected calls arrived", async () => {
    const barrier = createBarrier({ expected: 2 });
    const first = barrier.arrive();
    const state = await Promise.race([first.then(() => "opened"), Promise.resolve("pending")]);
    expect(state).toBe("pending");
    const second = barrier.arrive();
    await Promise.all([first, second]);
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

  test("throws when expected is below 1", () => {
    expect(() => createBarrier({ expected: 0 })).toThrow();
  });
});
