import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { LIVE_REFETCH_COALESCE_MS } from "../../hooks/live-refetch-scheduler.ts";
import {
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../index.ts";
import type { NavApi } from "../nav.tsx";
import { useProjectionDetailData } from "../use-projection-detail-data.ts";

type QueryFn = Dispatcher["query"];
type QueryResult = Awaited<ReturnType<QueryFn>>;

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

const nav = { searchParams: {} } as unknown as NavApi;

function screenWith(live: boolean): ProjectionDetailScreenDefinition {
  return {
    id: "run",
    type: "projectionDetail",
    query: "readiness:query:probe-run:latest-summary",
    singleton: true,
    live,
    layout: { sections: [] },
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function renderDetail(live: boolean) {
  let calls = 0;
  const dispatcher = makeDispatcher((async () => {
    calls += 1;
    return { isSuccess: true, data: { id: "r1", okCount: calls } } as unknown as QueryResult;
  }) as unknown as QueryFn);
  const feed = createLiveFeed();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={feed.subscribe}>{children}</LiveEventsProvider>
    </DispatcherProvider>
  );
  const hook = renderHook(
    () =>
      useProjectionDetailData({
        screen: screenWith(live),
        Tabs: undefined,
        nav,
        effectiveEntityId: undefined,
      }),
    { wrapper },
  );
  return { hook, feed, calls: () => calls };
}

describe("projectionDetail live", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("an entity event refetches the record and reloads the related lists", async () => {
    const { hook, feed, calls } = renderDetail(true);
    await advance(0);
    expect(hook.result.current.reloadNonce).toBe(0);

    feed.emit("probe-run");
    await advance(LIVE_REFETCH_COALESCE_MS);

    expect(calls()).toBe(2);
    expect(hook.result.current.detailQuery.data).toEqual({ id: "r1", okCount: 2 });
    expect(hook.result.current.reloadNonce).toBe(1);
  });

  test("without live an entity event changes nothing", async () => {
    const { hook, feed, calls } = renderDetail(false);
    await advance(0);

    feed.emit("probe-run");
    await advance(LIVE_REFETCH_COALESCE_MS);

    expect(calls()).toBe(1);
    expect(hook.result.current.reloadNonce).toBe(0);
  });
});
