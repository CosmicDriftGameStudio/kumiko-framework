import { describe, expect, test } from "bun:test";
import { forEachWithConcurrency } from "../account-poll-schedule.ts";

describe("forEachWithConcurrency", () => {
  test("never runs more items side by side than the limit, and finishes all of them", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];

    await forEachWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      2,
      async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        await Promise.resolve();
        running -= 1;
        done.push(item);
      },
      () => {},
    );

    expect(peak).toBe(2);
    expect(done.toSorted()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("reports a failing item and still runs the others", async () => {
    const failed: number[] = [];
    const done: number[] = [];

    await forEachWithConcurrency(
      [1, 2, 3],
      2,
      async (item) => {
        if (item === 2) throw new Error("boom");
        done.push(item);
      },
      (item) => failed.push(item),
    );

    expect(failed).toEqual([2]);
    expect(done.toSorted()).toEqual([1, 3]);
  });
});
