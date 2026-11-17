import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { LIVE_RESYNC_EVENT_TYPE, type LiveEventSubscriber, LiveEventsProvider } from "../../index.ts";
import { createLiveDispatcher } from "../../live/index.ts";
import { LIVE_REFETCH_COALESCE_MS } from "../live-refetch-scheduler.ts";
import { useQuery } from "../use-query.ts";

type PendingCall = {
  readonly path: string;
  readonly init: RequestInit;
  readonly respond: (body: unknown) => void;
};

function deferredFetch(): { fetch: typeof fetch; calls: PendingCall[] } {
  const calls: PendingCall[] = [];
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolve, reject) => {
      const requestInit = init ?? {};
      calls.push({
        path: String(input),
        init: requestInit,
        respond: (body) =>
          resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
      });
      requestInit.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  return { fetch: fakeFetch as typeof fetch, calls };
}

const QUERY_TYPE = "f:query:x:list";
const ANSWER = { data: { rows: [1] } };

function setup() {
  const fake = deferredFetch();
  const dispatcher = createLiveDispatcher({ fetch: fake.fetch, readCsrf: () => undefined });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
  return { calls: fake.calls, wrapper };
}

function Reader({ testId }: { readonly testId: string }): ReactNode {
  const { data } = useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 });
  return <output data-testid={testId}>{data === null ? "" : data.rows.join(",")}</output>;
}

describe("useQuery shared in-flight request", () => {
  test("two hooks with the same type and payload send one request", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
        second: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    expect(calls).toHaveLength(1);
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    expect(result.current.first.data).toEqual({ rows: [1] });
    expect(result.current.second.data).toEqual({ rows: [1] });
  });

  test("refetch() while the first request is open sends a second request", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
        second: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    expect(calls).toHaveLength(1);
    await act(async () => {
      void result.current.first.refetch();
    });
    expect(calls).toHaveLength(2);
  });

  test("unmounting one of two hooks keeps the request alive for the other", async () => {
    const { calls, wrapper: Wrapper } = setup();
    const tree = (both: boolean) => (
      <Wrapper>
        <Reader testId="a" />
        {both ? <Reader testId="b" /> : null}
      </Wrapper>
    );
    const view = render(tree(true));
    await act(async () => {});
    expect(calls).toHaveLength(1);
    view.rerender(tree(false));
    await act(async () => {});
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    expect(view.getByTestId("a").textContent).toBe("1");
    cleanup();
  });

  test("a refetch from one hook updates the other hook on the same key", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
        second: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    await act(async () => {
      void result.current.first.refetch();
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1]?.respond({ data: { rows: [2] } });
    });
    expect(result.current.second.data).toEqual({ rows: [2] });
  });

  test("refetch() of two hooks in the same tick sends one request", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
        second: useQuery<{ rows: number[] }>(QUERY_TYPE, { a: 1 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    await act(async () => {
      void Promise.all([result.current.first.refetch(), result.current.second.refetch()]);
    });
    expect(calls).toHaveLength(2);
  });

  test("two hooks reading different resultField values share one request", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        first: useQuery<number>(QUERY_TYPE, { a: 1 }, { resultField: "a" }),
        second: useQuery<number>(QUERY_TYPE, { a: 1 }, { resultField: "b" }),
      }),
      { wrapper },
    );
    await act(async () => {});
    expect(calls).toHaveLength(1);
    await act(async () => {
      calls[0]?.respond({ data: { a: 1, b: 2 } });
    });
    expect(result.current.first.data).toBe(1);
    expect(result.current.second.data).toBe(2);
  });

  test("after every hook unmounted, a new mount sends a new request", async () => {
    const { calls, wrapper } = setup();
    const first = renderHook(() => useQuery(QUERY_TYPE, { a: 1 }), { wrapper });
    await act(async () => {});
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    first.unmount();
    await act(async () => {});
    renderHook(() => useQuery(QUERY_TYPE, { a: 1 }), { wrapper });
    await act(async () => {});
    expect(calls).toHaveLength(2);
  });
});

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

describe("useQuery shared timers and live events", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("polling of two hooks on one key sends one request per tick", async () => {
    jest.useFakeTimers();
    const { calls, wrapper } = setup();
    renderHook(
      () => ({
        first: useQuery(QUERY_TYPE, { a: 1 }, { refetchIntervalMs: 1000 }),
        second: useQuery(QUERY_TYPE, { a: 1 }, { refetchIntervalMs: 1000 }),
      }),
      { wrapper },
    );
    await act(async () => {});
    await act(async () => {
      calls[0]?.respond(ANSWER);
    });
    expect(calls).toHaveLength(1);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1]?.respond(ANSWER);
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(calls).toHaveLength(3);
  });

  test("a live event refetches once for two live hooks", async () => {
    jest.useFakeTimers();
    const fake = deferredFetch();
    const dispatcher = createLiveDispatcher({ fetch: fake.fetch, readCsrf: () => undefined });
    const feed = createLiveFeed();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <DispatcherProvider dispatcher={dispatcher}>
        <LiveEventsProvider value={feed.subscribe}>{children}</LiveEventsProvider>
      </DispatcherProvider>
    );
    renderHook(
      () => ({
        first: useQuery("f:query:invoice:list", {}, { live: true }),
        second: useQuery("f:query:invoice:list", {}, { live: true }),
      }),
      { wrapper },
    );
    await act(async () => {});
    await act(async () => {
      fake.calls[0]?.respond(ANSWER);
    });
    expect(fake.calls).toHaveLength(1);
    await act(async () => {
      feed.emit("invoice");
      jest.advanceTimersByTime(LIVE_REFETCH_COALESCE_MS);
    });
    expect(fake.calls).toHaveLength(2);
  });
});
