import { describe, expect, test } from "bun:test";
import { type ScreenParams, useLoadedAt } from "../app/dashboard-shared.tsx";
import { act, renderHook } from "./test-utils.tsx";

const PARAMS: ScreenParams = { filterParams: {}, rangeParams: {}, recordParams: {} };

describe("useLoadedAt", () => {
  test("a newer report moves the stamp forward, an older one never moves it back", () => {
    const { result } = renderHook(() => useLoadedAt(PARAMS));
    const start = result.current.loadedAtMs;
    act(() => result.current.reportLoaded(start + 5_000));
    expect(result.current.loadedAtMs).toBe(start + 5_000);
    act(() => result.current.reportLoaded(start + 1_000));
    expect(result.current.loadedAtMs).toBe(start + 5_000);
  });

  test("the first answer wins even when the app clock is pinned behind the device clock", () => {
    const { result } = renderHook(() => useLoadedAt(PARAMS));
    const pinnedBehindDevice = result.current.loadedAtMs - 24 * 3_600_000;
    act(() => result.current.reportLoaded(pinnedBehindDevice));
    expect(result.current.loadedAtMs).toBe(pinnedBehindDevice);
  });
});
