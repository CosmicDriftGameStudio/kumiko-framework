import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import {
  createMockDispatcher,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../__tests__/test-utils";
import { InfinityList } from "../infinity-list";

// jsdom hat keinen IntersectionObserver — Stub speichert den Callback pro
// Observer, damit Tests das "Sentinel wird sichtbar"-Event manuell auslösen
// können, statt echtes Scrollen zu simulieren.
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
});
