import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { Dispatcher } from "../../../headless/index.ts";
import {
  DispatcherProvider,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../../index.ts";
import { act, createMockDispatcher, render, screen } from "../../__tests__/test-utils.tsx";
import { InfinityList } from "../infinity-list.tsx";

type Row = { readonly id: string; readonly subject: string };
type Page = { readonly rows: readonly Row[]; readonly nextCursor: string | null };

const QUERY = "inbox:query:message:list";
const LIVE_DEBOUNCE_MS = 250;

type IntersectCallback = (entries: readonly { isIntersecting: boolean }[]) => void;
const activeObservers = new Set<IntersectCallback>();
globalThis.IntersectionObserver = class {
  private readonly cb: IntersectCallback;
  constructor(cb: IntersectCallback) {
    this.cb = cb;
    activeObservers.add(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    activeObservers.delete(this.cb);
  }
} as unknown as typeof IntersectionObserver;

function success(rows: readonly Row[], nextCursor: string | null) {
  return { isSuccess: true, data: { rows, nextCursor } };
}

async function flushPromises(): Promise<void> {
  await act(async () => {});
}

describe("InfinityList: live refresh racing a load-more", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("a page-1 change whose refresh is superseded by a load-more shows up without another event", async () => {
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
    render(
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
      </DispatcherProvider>,
    );
    await flushPromises();
    resolvers[0]?.(success([{ id: "m1", subject: "Mail (ungelesen)" }], "c1"));
    await flushPromises();
    expect(screen.getByText("Mail (ungelesen)")).toBeTruthy();

    act(() =>
      emit?.({
        type: "message",
        data: { aggregateType: "message", eventType: "updated", createdAt: "2026-02-03T04:05:06Z" },
      }),
    );
    act(() => {
      jest.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    });
    await flushPromises();
    expect(resolvers).toHaveLength(2);

    act(() => {
      for (const callback of activeObservers) callback([{ isIntersecting: true }]);
    });
    await flushPromises();
    expect(resolvers).toHaveLength(3);

    resolvers[1]?.(success([{ id: "m1", subject: "Mail (gelesen)" }], "c1"));
    await flushPromises();
    resolvers[2]?.(success([{ id: "m2", subject: "Older mail" }], null));
    await flushPromises();
    act(() => {
      jest.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    });
    await flushPromises();
    // The follow-up refresh, if any, is the fourth query.
    resolvers[3]?.(success([{ id: "m1", subject: "Mail (gelesen)" }], "c1"));
    await flushPromises();

    expect(screen.getByText("Older mail")).toBeTruthy();
    expect(screen.getByText("Mail (gelesen)")).toBeTruthy();
    expect(screen.queryByText("Mail (ungelesen)")).toBeNull();
  });
});
