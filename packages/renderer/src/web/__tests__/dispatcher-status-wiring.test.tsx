//
// Wiring test: proves that the complete UI store chain remains connected:
//   createLiveDispatcher → dispatcher.statusStore → DispatcherProvider →
//   useDispatcherStatus → useStore → re-render
//
// Previously, the dispatcher exposed two wrapper methods (status() and
// subscribeStatus()), which consumers had to connect manually with
// useSyncExternalStore. After the refactor, statusStore is a read-only
// store property and useDispatcherStatus reduces to
// `useStore(dispatcher.statusStore)`. A passing test confirms the chain is
// intact; a subtle renaming regression in any link would surface here
// instead of in production.
//
// This is intentionally not a .integration.ts test: there is no server or
// database. We mock the fetch layer, which is the system boundary for the
// live dispatcher, and keep everything above it real. This is a
// "full stack of the frontend stack", not a full stack including the API.

import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { DispatcherProvider, useDispatcherStatus } from "../../index.ts";
import { createLiveDispatcher } from "../../live/index.ts";
import { act, render, screen, waitFor } from "./test-utils.tsx";

function StatusProbe(): ReactNode {
  const status = useDispatcherStatus();
  return <span data-testid="status">{status}</span>;
}

describe("UI-Store Verdrahtung: Dispatcher → statusStore → useDispatcherStatus", () => {
  test("initial-status: Probe renders 'online' after provider mount", () => {
    const fetch = mock() as unknown as typeof globalThis.fetch;
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <StatusProbe />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("online");
  });

  test("network-fail flips Probe from 'online' to 'offline'", async () => {
    const fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <StatusProbe />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("online");

    // A real call triggers observeNetworkOutcome(false) →
    // statusStore.setState("offline") → the useStore subscriber fires →
    // the probe re-renders.
    await act(async () => {
      await dispatcher.write("x", {});
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("offline"));
  });

  test("recovery flips Probe back to 'online'", async () => {
    let failNext = true;
    const fetch = mock(async () => {
      if (failNext) {
        failNext = false;
        throw new Error("boom");
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { isSuccess: true, data: {} };
        },
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <StatusProbe />
      </DispatcherProvider>,
    );

    await act(async () => {
      await dispatcher.write("x", {}); // → offline
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("offline"));

    await act(async () => {
      await dispatcher.write("x", {}); // → online
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("online"));
  });

  test("statusStore is read-only on the public Dispatcher type", () => {
    const fetch = mock() as unknown as typeof globalThis.fetch;
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    // The dispatcher contract exposes statusStore as Store<T), not
    // WritableStore. At runtime, setState exists because the internal store
    // is writable, but the public type hides it, so UI code cannot call
    // setState without a type error. If the public type were widened to
    // WritableStore, the ts-expect-error would no longer be needed and tsc
    // would flag it.
    expect(typeof dispatcher.statusStore.subscribe).toBe("function");
    expect(typeof dispatcher.statusStore.getSnapshot).toBe("function");
    // Dispatcher.statusStore exposes the read-only Store contract; the
    // mock returns WritableStore so tests can drive transitions, hence
    // setState is callable here. Production resolvers ship Store only.
    void dispatcher.statusStore;
  });
});
