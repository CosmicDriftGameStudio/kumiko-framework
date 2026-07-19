import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useDisclosure } from "../use-disclosure";

describe("useDisclosure", () => {
  test("open/close/toggle steuern den Zustand", () => {
    const { result } = renderHook(() => useDisclosure());
    expect(result.current.open).toBe(false);
    act(() => result.current.onOpen());
    expect(result.current.open).toBe(true);
    act(() => result.current.onClose());
    expect(result.current.open).toBe(false);
    act(() => result.current.onToggle());
    expect(result.current.open).toBe(true);
  });

  test("Callbacks sind referenz-stabil über Re-Renders", () => {
    const { result, rerender } = renderHook(() => useDisclosure(true));
    const first = result.current;
    rerender();
    expect(result.current.onOpen).toBe(first.onOpen);
    expect(result.current.onClose).toBe(first.onClose);
    expect(result.current.onToggle).toBe(first.onToggle);
  });
});
