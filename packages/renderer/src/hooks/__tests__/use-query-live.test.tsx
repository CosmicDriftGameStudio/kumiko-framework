import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import {
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../index.ts";
import { LIVE_REFETCH_COALESCE_MS } from "../live-refetch-scheduler.ts";
import { useQuery } from "../use-query.ts";

type QueryFn = Dispatcher["query"];
type QueryResult = Awaited<ReturnType<QueryFn>>;

const QUERY_TYPE = "f:query:invoice:list";

function makeDispatcher(query: QueryFn): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function createLiveFeed(): { subscribe: LiveEventSubscriber; emit: (entity: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  return {
    subscribe: (entity, listener) => {
      const set = listeners.get(entity) ?? new Set();
      listeners.set(entity, set);
      const wrapped = () =>
        listener({
          type: entity,
          data: {
            aggregateType: entity,
            eventType: LIVE_RESYNC_EVENT_TYPE,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        });
      set.add(wrapped);
      return () => set.delete(wrapped);
    },
    emit: (entity) => {
      for (const listener of listeners.get(entity) ?? []) listener();
    },
  };
}

function wrapperFor(dispatcher: Dispatcher, subscribe: LiveEventSubscriber) {
  return ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={subscribe}>{children}</LiveEventsProvider>
    </DispatcherProvider>
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function success(n: number): QueryResult {
  return { isSuccess: true, data: { n } } as unknown as QueryResult;
}

describe("useQuery live refetch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a burst of events inside the window triggers one refetch", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      return success(calls);
    }) as unknown as QueryFn);
    const feed = createLiveFeed();
    const { result } = renderHook(() => useQuery<{ n: number }>(QUERY_TYPE, {}, { live: true }), {
      wrapper: wrapperFor(dispatcher, feed.subscribe),
    });
    await advance(0);
    expect(calls).toBe(1);

    for (let i = 0; i < 5; i++) feed.emit("invoice");
    expect(calls).toBe(1);
    await advance(LIVE_REFETCH_COALESCE_MS);

    expect(calls).toBe(2);
    expect(result.current.data).toEqual({ n: 2 });
  });

  test("the live refetch runs in the background without a loading flip", async () => {
    const dispatcher = makeDispatcher((async () => success(1)) as unknown as QueryFn);
    const feed = createLiveFeed();
    const { result } = renderHook(() => useQuery(QUERY_TYPE, {}, { live: true }), {
      wrapper: wrapperFor(dispatcher, feed.subscribe),
    });
    await advance(0);

    feed.emit("invoice");
    await act(async () => {
      jest.advanceTimersByTime(LIVE_REFETCH_COALESCE_MS - 1);
    });
    expect(result.current.loading).toBe(false);
    feed.emit("invoice");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(result.current.loading).toBe(false);
  });

  test("events during an in-flight refetch queue exactly one follow-up", async () => {
    const pending: Array<(result: QueryResult) => void> = [];
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      if (calls === 1) return success(calls);
      return new Promise<QueryResult>((resolve) => pending.push(resolve));
    }) as unknown as QueryFn);
    const feed = createLiveFeed();
    renderHook(() => useQuery(QUERY_TYPE, {}, { live: true }), {
      wrapper: wrapperFor(dispatcher, feed.subscribe),
    });
    await advance(0);

    feed.emit("invoice");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls).toBe(2);

    feed.emit("invoice");
    feed.emit("invoice");
    feed.emit("invoice");
    await advance(LIVE_REFETCH_COALESCE_MS * 4);
    expect(calls).toBe(2);

    await act(async () => {
      pending[0]?.(success(2));
    });
    expect(calls).toBe(3);

    await act(async () => {
      pending[1]?.(success(3));
    });
    await advance(LIVE_REFETCH_COALESCE_MS * 4);
    expect(calls).toBe(3);
  });

  test("a failed refetch keeps the last data and reports the error", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      if (calls === 1) return success(1);
      return {
        isSuccess: false,
        error: { code: "internal_error", message: "boom" },
      } as unknown as QueryResult;
    }) as unknown as QueryFn);
    const feed = createLiveFeed();
    const { result } = renderHook(() => useQuery<{ n: number }>(QUERY_TYPE, {}, { live: true }), {
      wrapper: wrapperFor(dispatcher, feed.subscribe),
    });
    await advance(0);

    feed.emit("invoice");
    await advance(LIVE_REFETCH_COALESCE_MS);

    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error?.code).toBe("internal_error");
    expect(result.current.loading).toBe(false);
  });

  test("unmounting drops a pending coalesced refetch", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      return success(calls);
    }) as unknown as QueryFn);
    const feed = createLiveFeed();
    const { unmount } = renderHook(() => useQuery(QUERY_TYPE, {}, { live: true }), {
      wrapper: wrapperFor(dispatcher, feed.subscribe),
    });
    await advance(0);

    feed.emit("invoice");
    unmount();
    await advance(LIVE_REFETCH_COALESCE_MS * 4);

    expect(calls).toBe(1);
  });
});
