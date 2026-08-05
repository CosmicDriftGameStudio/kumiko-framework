import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import {
  act,
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../__tests__/test-utils";
import { InfinityList } from "../infinity-list";

// Fake LiveEventSubscriber for live-mode tests — collects subscribers,
// `inject(type, data)` fires the ones matching `data.aggregateType`.
// Same shape as production; mirrors use-query-live.test.tsx's helper.
function makeFakeLiveEvents(): {
  subscriber: LiveEventSubscriber;
  inject: (type: string, data: LiveEvent["data"]) => void;
} {
  const listeners = new Set<{ entity: string; cb: (e: LiveEvent) => void }>();
  return {
    subscriber: (entity, cb) => {
      const entry = { entity, cb };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    inject: (type, data) => {
      for (const l of listeners) {
        if (l.entity === data.aggregateType) l.cb({ type, data });
      }
    },
  };
}

// jsdom has no IntersectionObserver — stub stores the callback per observer
// so tests can fire the "sentinel became visible" event manually instead of
// simulating real scrolling.
const observers: ((entries: readonly { isIntersecting: boolean }[]) => void)[] = [];
globalThis.IntersectionObserver = class {
  constructor(cb: (entries: readonly { isIntersecting: boolean }[]) => void) {
    observers.push(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof IntersectionObserver;

function fireIntersect(): void {
  observers[observers.length - 1]?.([{ isIntersecting: true }]);
}

function renderWithDispatcher(ui: ReactNode, dispatcher: Dispatcher) {
  return render(<DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>);
}

function renderWithLive(ui: ReactNode, dispatcher: Dispatcher, liveEvents: LiveEventSubscriber) {
  return render(
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={liveEvents}>{ui}</LiveEventsProvider>
    </DispatcherProvider>,
  );
}

type Row = { readonly id: string; readonly subject: string };
type Page = { readonly rows: readonly Row[]; readonly nextCursor: string | null };

function list(query: string) {
  return (
    <InfinityList<Page, Row>
      query={query}
      rows={(data) => data.rows}
      nextCursor={(data) => data.nextCursor}
      rowId={(row) => row.id}
      renderRow={(row) => <span>{row.subject}</span>}
      testId="inbox"
    />
  );
}

describe("InfinityList", () => {
  test("rendert die erste Seite", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "m1", subject: "Hallo" }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(list("inbox:query:message:list"), dispatcher);
    await waitFor(() => expect(screen.getByText("Hallo")).toBeTruthy());
  });

  test("lädt die nächste Seite nach, sobald der Sentinel sichtbar wird", async () => {
    let calls = 0;
    const dispatcher = createMockDispatcher({
      query: (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            isSuccess: true,
            data: { rows: [{ id: "m1", subject: "Erste" }], nextCursor: "c1" },
          };
        }
        return {
          isSuccess: true,
          data: { rows: [{ id: "m2", subject: "Zweite" }], nextCursor: null },
        };
      }) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(list("inbox:query:message:list"), dispatcher);
    await waitFor(() => expect(screen.getByText("Erste")).toBeTruthy());
    fireIntersect();
    await waitFor(() => expect(screen.getByText("Zweite")).toBeTruthy());
    expect(screen.getByText("Erste")).toBeTruthy();
    expect(calls).toBe(2);
  });

  test("Fehler → ErrorState, Retry lädt neu", async () => {
    let calls = 0;
    const dispatcher = createMockDispatcher({
      query: (async () => {
        calls += 1;
        if (calls === 1) {
          return {
            isSuccess: false,
            error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
          };
        }
        return {
          isSuccess: true,
          data: { rows: [{ id: "m1", subject: "Hallo" }], nextCursor: null },
        };
      }) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(list("inbox:query:message:list"), dispatcher);
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Hallo")).toBeTruthy());
    expect(calls).toBe(2);
  });

  test("leeres Result rendert Empty-State", async () => {
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    renderWithDispatcher(
      <InfinityList<Page, Row>
        query="inbox:query:message:list"
        rows={(data) => data.rows}
        nextCursor={(data) => data.nextCursor}
        rowId={(row) => row.id}
        renderRow={(row) => <span>{row.subject}</span>}
        emptyState={<span>Keine Nachrichten</span>}
      />,
      dispatcher,
    );
    await waitFor(() => expect(screen.getByText("Keine Nachrichten")).toBeTruthy());
  });

  // fw#1705: a fast payload change (e.g. two keystrokes in a search field)
  // fires a second request before the first resolves. Without sequencing,
  // a slow first response landing after a faster second one clobbers it —
  // the displayed rows end up out of sync with the current payload.
  test("verwirft eine überholte Response, wenn eine frühere Anfrage später auflöst", async () => {
    const resolvers: Array<(res: unknown) => void> = [];
    const dispatcher = createMockDispatcher({
      query: (() =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })) as unknown as Dispatcher["query"],
    });

    function SearchList({ search }: { readonly search: string }) {
      return (
        <InfinityList<Page, Row>
          query="inbox:query:message:list"
          payload={{ search }}
          rows={(data) => data.rows}
          nextCursor={(data) => data.nextCursor}
          rowId={(row) => row.id}
          renderRow={(row) => <span>{row.subject}</span>}
          testId="inbox"
        />
      );
    }

    const { rerender } = renderWithDispatcher(<SearchList search="Bo" />, dispatcher);
    await waitFor(() => expect(resolvers.length).toBe(1));

    rerender(
      <DispatcherProvider dispatcher={dispatcher}>
        <SearchList search="Bob" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(resolvers.length).toBe(2));

    // "Bob" (second, faster) resolves first.
    resolvers[1]?.({
      isSuccess: true,
      data: { rows: [{ id: "m2", subject: "Bob-Treffer" }], nextCursor: null },
    });
    await waitFor(() => expect(screen.getByText("Bob-Treffer")).toBeTruthy());

    // "Bo" (first, slower) resolves late — must be discarded, not overwrite the display.
    resolvers[0]?.({
      isSuccess: true,
      data: { rows: [{ id: "m1", subject: "Bo-Treffer" }], nextCursor: null },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText("Bo-Treffer")).toBeNull();
    expect(screen.getByText("Bob-Treffer")).toBeTruthy();
  });

  // fw#1827: InfinityList used dispatcher.query directly and never subscribed
  // to live events, so a solon inbox stayed stale until the user reloaded.
  describe("Live-Mode", () => {
    test("SSE-Event mergt nur die erste Seite, bereits geladene Folgeseiten bleiben erhalten", async () => {
      const calls: Array<Readonly<Record<string, unknown>>> = [];
      const dispatcher = createMockDispatcher({
        query: ((_type: string, payload: Readonly<Record<string, unknown>>) => {
          calls.push(payload);
          if (calls.length === 1) {
            return Promise.resolve({
              isSuccess: true,
              data: { rows: [{ id: "m1", subject: "Alt-1" }], nextCursor: "c1" },
            });
          }
          if (calls.length === 2) {
            return Promise.resolve({
              isSuccess: true,
              data: { rows: [{ id: "m2", subject: "Alt-2" }], nextCursor: null },
            });
          }
          // Live refresh of the first page: m1 stays, a new row lands on top.
          return Promise.resolve({
            isSuccess: true,
            data: {
              rows: [
                { id: "m3", subject: "Neu" },
                { id: "m1", subject: "Alt-1" },
              ],
              nextCursor: "c1",
            },
          });
        }) as unknown as Dispatcher["query"],
      });
      const fake = makeFakeLiveEvents();

      renderWithLive(
        <InfinityList<Page, Row>
          query="inbox:query:message:list"
          pageSize={1}
          rows={(data) => data.rows}
          nextCursor={(data) => data.nextCursor}
          rowId={(row) => row.id}
          renderRow={(row) => <span>{row.subject}</span>}
          testId="inbox"
        />,
        dispatcher,
        fake.subscriber,
      );

      await waitFor(() => expect(screen.getByText("Alt-1")).toBeTruthy());
      fireIntersect();
      await waitFor(() => expect(screen.getByText("Alt-2")).toBeTruthy());
      expect(calls.length).toBe(2);

      act(() => {
        fake.inject("message.created", {
          id: "m3",
          aggregateType: "message",
          version: 1,
          payload: {},
          createdAt: "",
        });
      });

      await waitFor(() => expect(screen.getByText("Neu")).toBeTruthy());
      expect(screen.getByText("Alt-1")).toBeTruthy();
      expect(screen.getByText("Alt-2")).toBeTruthy();
      expect(screen.getAllByText("Alt-1").length).toBe(1);

      // The live refresh only requests the first page — no cursor in the payload.
      expect(calls[2]).toEqual({ limit: 1 });
    });

    test("live=false: SSE-Event wird ignoriert, kein Refetch", async () => {
      let calls = 0;
      const dispatcher = createMockDispatcher({
        query: (() => {
          calls += 1;
          return Promise.resolve({
            isSuccess: true,
            data: { rows: [{ id: "m1", subject: "Hallo" }], nextCursor: null },
          });
        }) as unknown as Dispatcher["query"],
      });
      const fake = makeFakeLiveEvents();

      renderWithLive(
        <InfinityList<Page, Row>
          query="inbox:query:message:list"
          live={false}
          rows={(data) => data.rows}
          nextCursor={(data) => data.nextCursor}
          rowId={(row) => row.id}
          renderRow={(row) => <span>{row.subject}</span>}
          testId="inbox"
        />,
        dispatcher,
        fake.subscriber,
      );

      await waitFor(() => expect(screen.getByText("Hallo")).toBeTruthy());

      fake.inject("message.created", {
        id: "m2",
        aggregateType: "message",
        version: 1,
        payload: {},
        createdAt: "",
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(1);
    });

    test("nur Events für die Query-Entity triggern den Refresh", async () => {
      let calls = 0;
      const dispatcher = createMockDispatcher({
        query: (() => {
          calls += 1;
          return Promise.resolve({
            isSuccess: true,
            data: { rows: [{ id: "m1", subject: "Hallo" }], nextCursor: null },
          });
        }) as unknown as Dispatcher["query"],
      });
      const fake = makeFakeLiveEvents();

      renderWithLive(
        <InfinityList<Page, Row>
          query="inbox:query:message:list"
          rows={(data) => data.rows}
          nextCursor={(data) => data.nextCursor}
          rowId={(row) => row.id}
          renderRow={(row) => <span>{row.subject}</span>}
          testId="inbox"
        />,
        dispatcher,
        fake.subscriber,
      );

      await waitFor(() => expect(screen.getByText("Hallo")).toBeTruthy());

      fake.inject("note.created", {
        id: "n1",
        aggregateType: "note",
        version: 1,
        payload: {},
        createdAt: "",
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toBe(1);
    });

    // A live event arriving while the mount fetch is still in flight must not
    // discard that fetch — it's the normal case for #1827's own scenario (a
    // screen mounts while writes are already streaming in).
    test("SSE-Event während der ersten Ladephase lässt die Mount-Anfrage trotzdem landen", async () => {
      const resolvers: Array<(res: unknown) => void> = [];
      const dispatcher = createMockDispatcher({
        query: (() =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          })) as unknown as Dispatcher["query"],
      });
      const fake = makeFakeLiveEvents();

      renderWithLive(list("inbox:query:message:list"), dispatcher, fake.subscriber);

      await waitFor(() => expect(resolvers.length).toBe(1));

      act(() => {
        fake.inject("message.created", {
          id: "m2",
          aggregateType: "message",
          version: 1,
          payload: {},
          createdAt: "",
        });
      });
      await waitFor(() => expect(resolvers.length).toBe(2));

      act(() => {
        resolvers[0]?.({
          isSuccess: true,
          data: { rows: [{ id: "m1", subject: "Hallo" }], nextCursor: null },
        });
      });
      act(() => {
        resolvers[1]?.({
          isSuccess: true,
          data: { rows: [{ id: "m1", subject: "Hallo" }], nextCursor: null },
        });
      });

      await waitFor(() => expect(screen.getByText("Hallo")).toBeTruthy());
    });
  });
});
