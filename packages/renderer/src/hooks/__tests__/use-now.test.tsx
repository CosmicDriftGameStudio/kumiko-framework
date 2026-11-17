import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { noteServerClock, resetServerClock } from "../../server-clock.ts";
import { useNow } from "../use-now.ts";

const START_MS = Date.parse("2026-11-17T09:00:00.000Z");

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("useNow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime(new Date(START_MS));
    resetServerClock();
  });

  afterEach(() => {
    jest.useRealTimers();
    setSystemTime();
    resetServerClock();
  });

  test("returns the current time and moves on every tick", async () => {
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(START_MS);
    await advance(1000);
    expect(result.current).toBe(START_MS + 1000);
    await advance(1000);
    expect(result.current).toBe(START_MS + 2000);
  });

  test("null holds the value", async () => {
    const { result } = renderHook(() => useNow(null));
    await advance(5000);
    expect(result.current).toBe(START_MS);
  });

  test("switching from null to an interval refreshes at once", async () => {
    const initialProps: { intervalMs: number | null } = { intervalMs: null };
    const { result, rerender } = renderHook(({ intervalMs }) => useNow(intervalMs), {
      initialProps,
    });
    await advance(5000);
    act(() => rerender({ intervalMs: 1000 }));
    expect(result.current).toBe(START_MS + 5000);
  });

  test("follows the server clock offset", () => {
    noteServerClock(new Headers({ "x-kumiko-now": new Date(START_MS + 60_000).toISOString() }));
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(START_MS + 60_000);
  });
});
