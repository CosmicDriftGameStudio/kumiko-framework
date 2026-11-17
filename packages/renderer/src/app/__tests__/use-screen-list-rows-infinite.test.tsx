import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { LIVE_REFETCH_COALESCE_MS } from "../../hooks/live-refetch-scheduler.ts";
import type { ListAggregates } from "../../hooks/use-list-aggregates.ts";
import {
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../index.ts";
import { useScreenListRows } from "../use-screen-list-rows.ts";
import { createMockDispatcher, type MockQueryHandler } from "../../testing.ts";

type QueryFn = MockQueryHandler;
type QueryResult = Awaited<ReturnType<QueryFn>>;
type JobRow = { readonly id: string; readonly status: string };

const QUERY_TYPE = "jobs:query:job-run:list";

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

const aggregates: ListAggregates = {
  grouped: false,
  rows: [],
  groupPages: {
    queryType: QUERY_TYPE,
    requests: [],
    onResult: () => {},
    refreshNonce: 0,
    resetKey: "",
  },
  refresh: () => {},
  loading: false,
  error: null,
};

async function flush(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
}

function setup() {
  const server: { firstPage: JobRow[]; secondPage: JobRow[]; failCursor: boolean } = {
    firstPage: [
      { id: "a", status: "queued" },
      { id: "b", status: "queued" },
    ],
    secondPage: [{ id: "c", status: "queued" }],
    failCursor: false,
  };
  const payloads: Record<string, unknown>[] = [];
  const dispatcher = createMockDispatcher({ query: (async (_type: string, payload: Record<string, unknown>) => {
    payloads.push(payload);
    if (payload["cursor"] === "c1") {
      if (server.failCursor) {
        return { isSuccess: false, error: { code: "network", message: "x" } };
      }
      return { isSuccess: true, data: { rows: server.secondPage, nextCursor: null } };
    }
    return { isSuccess: true, data: { rows: server.firstPage, nextCursor: "c1" } };
  }) as unknown as QueryFn });
  const feed = createLiveFeed();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={feed.subscribe}>{children}</LiveEventsProvider>
    </DispatcherProvider>
  );
  const hook = renderHook(
    () =>
      useScreenListRows({
        queryType: QUERY_TYPE,
        payload: { limit: 2 },
        infinite: true,
        aggregates,
      }),
    { wrapper },
  );
  return { hook, feed, server, payloads };
}

const rowIds = (rows: readonly Record<string, unknown>[]): unknown[] => rows.map((r) => r["id"]);

async function loadSecondPage(hook: ReturnType<typeof setup>["hook"]): Promise<void> {
  await flush();
  expect(rowIds(hook.result.current.rows)).toEqual(["a", "b"]);
  act(() => hook.result.current.infinite?.onReachEnd());
  await flush();
  expect(rowIds(hook.result.current.rows)).toEqual(["a", "b", "c"]);
}

describe("useScreenListRows infinite", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("a live event after a load-more updates a row of the first page", async () => {
    const { hook, feed, server, payloads } = setup();
    await loadSecondPage(hook);

    server.firstPage = [
      { id: "a", status: "done" },
      { id: "b", status: "queued" },
    ];
    feed.emit("job-run");
    await act(async () => {
      jest.advanceTimersByTime(LIVE_REFETCH_COALESCE_MS);
    });
    await flush();

    const rows = hook.result.current.rows;
    expect(rowIds(rows)).toEqual(["a", "b", "c"]);
    expect(rows[0]?.["status"]).toBe("done");
    expect(hook.result.current.infinite?.hasMore).toBe(false);
    expect(payloads[payloads.length - 1]?.["cursor"]).toBeUndefined();
  });

  test("a row deleted from the first page disappears while later pages stay", async () => {
    const { hook, feed, server } = setup();
    await loadSecondPage(hook);

    server.firstPage = [{ id: "b", status: "queued" }];
    feed.emit("job-run");
    await act(async () => {
      jest.advanceTimersByTime(LIVE_REFETCH_COALESCE_MS);
    });
    await flush();

    expect(rowIds(hook.result.current.rows)).toEqual(["b", "c"]);
  });

  test("refreshAfterWrite keeps the loaded pages and refreshes rows beyond the first page", async () => {
    const { hook, server } = setup();
    await loadSecondPage(hook);

    server.secondPage = [{ id: "c", status: "done" }];
    await act(() => hook.result.current.refreshAfterWrite());

    const rows = hook.result.current.rows;
    expect(rows).toHaveLength(3);
    expect(rows[2]?.["status"]).toBe("done");
    expect(hook.result.current.infinite?.hasMore).toBe(false);
  });

  test("a failed load-more surfaces the error and retry clears it", async () => {
    const { hook, server } = setup();
    await flush();
    server.failCursor = true;
    act(() => hook.result.current.infinite?.onReachEnd());
    await flush();

    expect(hook.result.current.error).not.toBeNull();
    expect(rowIds(hook.result.current.rows)).toEqual(["a", "b"]);

    await act(() => hook.result.current.retry());
    expect(hook.result.current.error).toBeNull();
  });
});
