import { describe, expect, test } from "bun:test";
import { burst } from "../burst.ts";

describe("burst", () => {
  test("starts all requests before the first resolves and tallies statuses", async () => {
    let started = 0;
    const startedAtResolve: number[] = [];
    const result = await burst({ dbPoolMax: 10 }, 5, async (index) => {
      started++;
      await Promise.resolve();
      startedAtResolve.push(started);
      return new Response(null, { status: index < 3 ? 200 : 429 });
    });
    expect(result.statuses).toEqual({ 200: 3, 429: 2 });
    expect(result.responses.length).toBe(5);
    expect(startedAtResolve).toEqual([5, 5, 5, 5, 5]);
  });

  test("throws before sending when the count exceeds the pool", async () => {
    let calls = 0;
    await expect(
      burst({ dbPoolMax: 2 }, 3, async () => {
        calls++;
        return new Response(null, { status: 200 });
      }),
    ).rejects.toThrow(/dbPoolMax/);
    expect(calls).toBe(0);
  });
});
