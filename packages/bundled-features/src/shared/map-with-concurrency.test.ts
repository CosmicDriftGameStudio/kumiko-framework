import { describe, expect, test } from "bun:test";
import { mapWithConcurrency } from "./map-with-concurrency";

describe("mapWithConcurrency", () => {
  test("preserves result order regardless of completion order", async () => {
    const delays = [30, 10, 20, 0];
    const results = await mapWithConcurrency(delays, 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  test("never runs more than `limit` calls concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return item;
    });
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1);
  });

  test("propagates the first rejection", async () => {
    const items = [1, 2, 3];
    await expect(
      mapWithConcurrency(items, 4, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });

  // Two workers rejecting at different times, under 4-way concurrency —
  // regression guard for the #1398 hazard (an eagerly-fired, never-awaited
  // Promise surfacing as an unattributed unhandled rejection). Every
  // worker promise here is an element of the internal `Promise.all` array,
  // so both rejections are always handled even though the aggregate
  // `mapWithConcurrency` call already settled on the first one.
  test("a second rejection after the first doesn't surface as an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      await expect(
        mapWithConcurrency(items, 4, async (item) => {
          if (item === 2) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            throw new Error("boom-early");
          }
          if (item === 5) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw new Error("boom-late");
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          return item;
        }),
      ).rejects.toThrow("boom-early");
      // Give the later-rejecting worker's promise a chance to settle and
      // for a real unhandled rejection (if any) to fire.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
    expect(unhandled).toEqual([]);
  });

  test("does not claim new items after the first rejection", async () => {
    const started: number[] = [];
    const items = Array.from({ length: 20 }, (_, i) => i);
    await expect(
      mapWithConcurrency(items, 2, async (item) => {
        started.push(item);
        if (item === 0) throw new Error("boom");
        // Slow enough that without fail-fast, more workers would drain the list.
        await new Promise((resolve) => setTimeout(resolve, 30));
        return item;
      }),
    ).rejects.toThrow("boom");
    // At most `limit` in-flight when the first throw sets `failed`; without
    // the flag the other worker would keep claiming the rest of the 20.
    expect(started.length).toBeLessThan(items.length);
    expect(started.length).toBeLessThanOrEqual(3);
  });

  test("empty input resolves to an empty array without running the worker", async () => {
    const results = await mapWithConcurrency<number, number>([], 4, async (item) => item);
    expect(results).toEqual([]);
  });

  test("limit larger than item count doesn't over-spawn workers", async () => {
    const items = [1, 2];
    const results = await mapWithConcurrency(items, 10, async (item) => item * 2);
    expect(results).toEqual([2, 4]);
  });
});
