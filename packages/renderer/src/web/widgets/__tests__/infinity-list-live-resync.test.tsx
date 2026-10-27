import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../../headless/index.ts";
import {
  DispatcherProvider,
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../../index.ts";
import { act, createMockDispatcher, render, screen } from "../../__tests__/test-utils.tsx";
import { createEventSourceLiveEvents } from "../../sse/live-events.ts";
import { InfinityList } from "../infinity-list.tsx";

type Row = { readonly id: string; readonly subject: string };
type Page = { readonly rows: readonly Row[]; readonly nextCursor: string | null };

const QUERY = "inbox:query:message:list";
const LIVE_DEBOUNCE_MS = 250;

// Only what createEventSourceLiveEvents uses; open() is driven by the test.
class ManualEventSource {
  static instances: ManualEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 0;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    ManualEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = ManualEventSource.CLOSED;
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }
}

function renderList(dispatcher: Dispatcher, liveEvents: LiveEventSubscriber): void {
  const ui: ReactNode = (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={liveEvents}>
        <InfinityList<Page, Row>
          query={QUERY}
          rows={(data) => data.rows}
          nextCursor={(data) => data.nextCursor}
          rowId={(row) => row.id}
          renderRow={(row) => <span>{row.subject}</span>}
          testId="inbox"
          live={true}
        />
      </LiveEventsProvider>
    </DispatcherProvider>
  );
  render(ui);
}

function pageOf(subject: string) {
  return { isSuccess: true, data: { rows: [{ id: "m1", subject }], nextCursor: null } };
}

async function flushPromises(): Promise<void> {
  await act(async () => {});
}

async function advanceLiveDebounce(): Promise<void> {
  act(() => {
    jest.advanceTimersByTime(LIVE_DEBOUNCE_MS);
  });
  await flushPromises();
}

describe("InfinityList: live resync on the first stream open", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    ManualEventSource.instances = [];
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  // Page 1 is queried in parallel with the SSE connection setup. A change between
  // that query and the stream going live emits no frame, so only the resync the
  // first open sends can bring the list up to date.
  test("a change between the page-1 query and the first stream open shows up without any frame", async () => {
    Object.defineProperty(globalThis, "EventSource", {
      value: ManualEventSource,
      configurable: true,
      writable: true,
    });
    let backingSubject = "Mail (ungelesen)";
    let queryCount = 0;
    const dispatcher = createMockDispatcher({
      query: (async () => {
        queryCount += 1;
        return pageOf(backingSubject);
      }) as unknown as Dispatcher["query"],
    });

    renderList(dispatcher, createEventSourceLiveEvents());
    await flushPromises();
    expect(screen.getByText("Mail (ungelesen)")).toBeTruthy();
    expect(queryCount).toBe(1);

    backingSubject = "Mail (gelesen)";
    const source = ManualEventSource.instances.at(-1);
    expect(source).toBeDefined();
    act(() => source?.open());
    await advanceLiveDebounce();

    expect(queryCount).toBe(2);
    expect(screen.getByText("Mail (gelesen)")).toBeTruthy();
    expect(screen.queryByText("Mail (ungelesen)")).toBeNull();
  });

  // The resync of the first open can arrive while the initial load is still
  // running; that load was issued before the change, so its answer is stale.
  test("a refresh that lands during the initial load wins over the older load", async () => {
    const resolvers: Array<(res: unknown) => void> = [];
    const dispatcher = createMockDispatcher({
      query: (() =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })) as unknown as Dispatcher["query"],
    });
    let emit: ((event: LiveEvent) => void) | undefined;
    const liveEvents: LiveEventSubscriber = (_entity, listener) => {
      emit = listener;
      return () => {};
    };

    renderList(dispatcher, liveEvents);
    await flushPromises();
    expect(resolvers).toHaveLength(1);

    act(() =>
      emit?.({
        type: "message",
        data: {
          aggregateType: "message",
          eventType: LIVE_RESYNC_EVENT_TYPE,
          createdAt: "2026-02-03T04:05:06Z",
        },
      }),
    );
    await advanceLiveDebounce();
    expect(resolvers).toHaveLength(2);

    resolvers[1]?.(pageOf("Frisch"));
    await flushPromises();
    expect(screen.getByText("Frisch")).toBeTruthy();

    resolvers[0]?.(pageOf("Veraltet"));
    await flushPromises();
    expect(screen.getByText("Frisch")).toBeTruthy();
    expect(screen.queryByText("Veraltet")).toBeNull();
  });

  test("a failed refresh during the initial load changes nothing, the load still lands", async () => {
    const resolvers: Array<(res: unknown) => void> = [];
    const dispatcher = createMockDispatcher({
      query: (() =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })) as unknown as Dispatcher["query"],
    });
    let emit: ((event: LiveEvent) => void) | undefined;
    const liveEvents: LiveEventSubscriber = (_entity, listener) => {
      emit = listener;
      return () => {};
    };

    renderList(dispatcher, liveEvents);
    await flushPromises();
    act(() =>
      emit?.({
        type: "message",
        data: {
          aggregateType: "message",
          eventType: LIVE_RESYNC_EVENT_TYPE,
          createdAt: "2026-02-03T04:05:06Z",
        },
      }),
    );
    await advanceLiveDebounce();
    expect(resolvers).toHaveLength(2);

    resolvers[1]?.({
      isSuccess: false,
      error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
    });
    await flushPromises();
    resolvers[0]?.(pageOf("Erste Seite"));
    await flushPromises();

    expect(screen.getByText("Erste Seite")).toBeTruthy();
  });
});
