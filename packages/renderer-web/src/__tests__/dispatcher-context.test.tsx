// @vitest-environment jsdom
import type { Dispatcher, StatusChangeListener } from "@kumiko/headless";
import { DispatcherProvider, useDispatcher, useDispatcherStatus } from "@kumiko/renderer";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { act, render, renderHook } from "./test-utils";

// Minimal fake dispatcher for testing. Only the three methods the
// context actually uses — the rest are no-op stubs and throw if touched,
// which tells us fast if a hook under test reaches somewhere it shouldn't.
function makeFakeDispatcher(): {
  readonly dispatcher: Dispatcher;
  setStatus(next: "online" | "offline" | "syncing"): void;
} {
  const listeners = new Set<StatusChangeListener>();
  let currentStatus: "online" | "offline" | "syncing" = "online";
  const dispatcher: Dispatcher = {
    write: async () => {
      throw new Error("write not used in this test");
    },
    query: async () => {
      throw new Error("query not used in this test");
    },
    batch: async () => {
      throw new Error("batch not used in this test");
    },
    status: () => currentStatus,
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return {
    dispatcher,
    setStatus(next) {
      currentStatus = next;
      for (const l of listeners) l(next);
    },
  };
}

function wrapper(dispatcher: Dispatcher) {
  return ({ children }: { children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("DispatcherContext", () => {
  test("useDispatcher returns the provided instance", () => {
    const { dispatcher } = makeFakeDispatcher();
    const { result } = renderHook(() => useDispatcher(), { wrapper: wrapper(dispatcher) });
    expect(result.current).toBe(dispatcher);
  });

  test("useDispatcher throws outside a provider — the app forgot to wrap root", () => {
    // renderHook surfaces hook-throws as result.current being the error —
    // we read it directly via render() and catch in the component.
    const Probe = (): ReactNode => {
      useDispatcher();
      return null;
    };
    expect(() => render(<Probe />)).toThrow(/no <DispatcherProvider> mounted/);
  });

  test("useDispatcherStatus reflects current status on mount", () => {
    const { dispatcher, setStatus } = makeFakeDispatcher();
    setStatus("offline");
    const { result } = renderHook(() => useDispatcherStatus(), { wrapper: wrapper(dispatcher) });
    expect(result.current).toBe("offline");
  });

  test("useDispatcherStatus updates when dispatcher.onStatusChange fires", () => {
    const { dispatcher, setStatus } = makeFakeDispatcher();
    const { result } = renderHook(() => useDispatcherStatus(), { wrapper: wrapper(dispatcher) });
    expect(result.current).toBe("online");
    act(() => setStatus("offline"));
    expect(result.current).toBe("offline");
    act(() => setStatus("online"));
    expect(result.current).toBe("online");
  });
});
