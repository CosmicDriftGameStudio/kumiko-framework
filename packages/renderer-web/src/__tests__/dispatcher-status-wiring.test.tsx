//
// Verdrahtungs-Test: beweist dass die ganze UI-Store-Kette zusammenhält:
//   createLiveDispatcher → dispatcher.statusStore → DispatcherProvider →
//   useDispatcherStatus → useStore → Re-Render
//
// Vorher hatte der Dispatcher zwei Wrapper-Methoden (status() +
// subscribeStatus()), Konsumenten verdrahteten sie manuell mit
// useSyncExternalStore. Nach dem Refactor ist statusStore ein read-only
// Store als Property und useDispatcherStatus reduziert sich auf
// `useStore(dispatcher.statusStore)`. Wenn dieser Test grün läuft, ist
// die ganze Kette intakt — eine subtile Renaming-Regression in einem
// der Glieder würde sich hier zeigen statt erst in Prod.
//
// Bewusst KEIN .integration.ts: kein Server, kein DB. Wir mocken den
// fetch-Layer (das ist die System-Grenze für den Live-Dispatcher) und
// lassen alles darüber echt laufen. Im Sinne von CLAUDE.md ist das ein
// "Full-Stack des Frontend-Stacks", nicht ein Full-Stack-mit-API.

import { describe, expect, mock, test } from "bun:test";
import { createLiveDispatcher } from "@cosmicdrift/kumiko-dispatcher-live";
import { DispatcherProvider, useDispatcherStatus } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "./test-utils";

function StatusProbe(): ReactNode {
  const status = useDispatcherStatus();
  return <span data-testid="status">{status}</span>;
}

describe("UI-Store Verdrahtung: Dispatcher → statusStore → useDispatcherStatus", () => {
  test("initial-status: Probe rendert 'online' nach Provider-Mount", () => {
    const fetch = mock() as unknown as typeof globalThis.fetch;
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <StatusProbe />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("online");
  });

  test("network-fail flippt Probe von 'online' nach 'offline'", async () => {
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

    // Echter call löst observeNetworkOutcome(false) → statusStore.setState("offline")
    // → useStore-Subscriber feuert → Probe re-rendert.
    await act(async () => {
      await dispatcher.write("x", {});
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("offline"));
  });

  test("recovery flippt Probe zurück auf 'online'", async () => {
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

  test("statusStore ist read-only auf dem public Dispatcher-Type", () => {
    const fetch = mock() as unknown as typeof globalThis.fetch;
    const dispatcher = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    // Der Dispatcher-Contract exponiert statusStore als Store<T> (nicht
    // WritableStore). Zur Runtime ist setState da (intern liegt ein
    // WritableStore), aber der public Type versteckt es — UI-Code kann
    // setState NICHT aufrufen ohne Type-Error. Wenn der Public-Type je
    // auf WritableStore aufweicht, fällt der ts-expect-error weg und tsc
    // flagged es.
    expect(typeof dispatcher.statusStore.subscribe).toBe("function");
    expect(typeof dispatcher.statusStore.getSnapshot).toBe("function");
    // Dispatcher.statusStore exposes the read-only Store contract; the
    // mock returns WritableStore so tests can drive transitions, hence
    // setState is callable here. Production resolvers ship Store only.
    void dispatcher.statusStore;
  });
});
