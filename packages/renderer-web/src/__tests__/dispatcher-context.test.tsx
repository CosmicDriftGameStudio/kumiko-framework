// @vitest-environment jsdom
import type { Dispatcher, DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  useDispatcher,
  useDispatcherStatus,
  useOptionalDispatcher,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { act, createMockDispatcher, render, renderHook } from "./test-utils";

// Minimal fake dispatcher: write/query/batch throwen, damit klar wird
// wenn ein Hook unter Test irgendwohin greift wo er nicht hingehört.
// Status-Mutationen laufen über den exposed setStatus-Helper, der den
// statusStore direkt schreibt.
function makeFakeDispatcher(): {
  readonly dispatcher: Dispatcher;
  setStatus(next: DispatcherStatus): void;
} {
  const dispatcher = createMockDispatcher({
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

  // useOptionalDispatcher: identisch zu useDispatcher AUSSER beim Missing-
  // Provider — dort returnt es undefined statt zu throwen. Genau dafür
  // existiert es: KumikoScreen.EntityListBody braucht den Dispatcher
  // optional (rowActions silent skipping wenn keiner mounted ist), und
  // soll nicht throw'en in Tests die kein Mutation-Wiring brauchen.
  test("useOptionalDispatcher: returns the instance when provider is mounted", () => {
    const { dispatcher } = makeFakeDispatcher();
    const { result } = renderHook(() => useOptionalDispatcher(), {
      wrapper: wrapper(dispatcher),
    });
    expect(result.current).toBe(dispatcher);
  });

  test("useOptionalDispatcher: returns undefined when no provider mounted (no throw)", () => {
    const Probe = (): ReactNode => {
      const d = useOptionalDispatcher();
      return <span data-testid="d">{d === undefined ? "no-provider" : "found"}</span>;
    };
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("d").textContent).toBe("no-provider");
  });
});
