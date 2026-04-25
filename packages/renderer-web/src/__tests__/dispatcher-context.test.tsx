// @vitest-environment jsdom
import type { Dispatcher, DispatcherStatus } from "@kumiko/headless";
import { DispatcherProvider, useDispatcher, useDispatcherStatus } from "@kumiko/renderer";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { act, makeMockDispatcher, render, renderHook } from "./test-utils";

// Minimal fake dispatcher: write/query/batch throwen, damit klar wird
// wenn ein Hook unter Test irgendwohin greift wo er nicht hingehört.
// Status-Mutationen laufen über den exposed setStatus-Helper, der den
// statusStore direkt schreibt.
function makeFakeDispatcher(): {
  readonly dispatcher: Dispatcher;
  setStatus(next: DispatcherStatus): void;
} {
  const dispatcher = makeMockDispatcher({
    write: async () => {
      throw new Error("write not used in this test");
    },
    query: async () => {
      throw new Error("query not used in this test");
    },
    batch: async () => {
      throw new Error("batch not used in this test");
    },
  });
  return {
    dispatcher,
    setStatus(next) {
      dispatcher.statusStore.setState(next);
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

  test("useDispatcherStatus updates when statusStore changes", () => {
    const { dispatcher, setStatus } = makeFakeDispatcher();
    const { result } = renderHook(() => useDispatcherStatus(), { wrapper: wrapper(dispatcher) });
    expect(result.current).toBe("online");
    act(() => setStatus("offline"));
    expect(result.current).toBe("offline");
    act(() => setStatus("online"));
    expect(result.current).toBe("online");
  });
});
