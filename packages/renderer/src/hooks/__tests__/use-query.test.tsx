import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { useQuery } from "../use-query.js";

type QueryFn = Dispatcher["query"];

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

function wrapperFor(dispatcher: Dispatcher) {
  return ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

function countingDispatcher(): { dispatcher: Dispatcher; calls: () => number } {
  let calls = 0;
  const query = (async () => {
    calls += 1;
    return { isSuccess: true, data: { n: calls } };
  }) as unknown as QueryFn;
  return { dispatcher: makeDispatcher(query), calls: () => calls };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

const QUERY_TYPE = "f:query:x:list";

describe("useQuery refetchIntervalMs", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("re-runs the query on every interval tick", async () => {
    const { dispatcher, calls } = countingDispatcher();
    const { result } = renderHook(
      () => useQuery<{ n: number }>(QUERY_TYPE, {}, { refetchIntervalMs: 1000 }),
      {
        wrapper: wrapperFor(dispatcher),
      },
    );
    await advance(0);
    expect(calls()).toBe(1);

    await advance(1000);
    expect(calls()).toBe(2);
    await advance(1000);
    expect(calls()).toBe(3);
    expect(result.current.data).toEqual({ n: 3 });
  });

  test("unmount stops the ticks", async () => {
    const { dispatcher, calls } = countingDispatcher();
    const { unmount } = renderHook(() => useQuery(QUERY_TYPE, {}, { refetchIntervalMs: 1000 }), {
      wrapper: wrapperFor(dispatcher),
    });
    await advance(1000);
    const before = calls();
    unmount();
    await advance(5000);
    expect(calls()).toBe(before);
  });

  test("enabled: false never ticks", async () => {
    const { dispatcher, calls } = countingDispatcher();
    renderHook(() => useQuery(QUERY_TYPE, {}, { enabled: false, refetchIntervalMs: 1000 }), {
      wrapper: wrapperFor(dispatcher),
    });
    await advance(5000);
    expect(calls()).toBe(0);
  });

  test("a tick while a fetch is in flight is skipped instead of aborting it", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const query = (async (_type: string, _payload: unknown, opts?: { signal?: AbortSignal }) => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return opts?.signal?.aborted
        ? { isSuccess: false, error: { code: "aborted", message: "aborted", i18nKey: "x" } }
        : { isSuccess: true, data: { done: true } };
    }) as unknown as QueryFn;
    const { result } = renderHook(
      () => useQuery<{ done: boolean }>(QUERY_TYPE, {}, { refetchIntervalMs: 1000 }),
      {
        wrapper: wrapperFor(makeDispatcher(query)),
      },
    );
    await advance(0);
    expect(calls).toBe(1);

    await advance(3000);
    expect(calls).toBe(1);

    await act(async () => {
      release?.();
    });
    expect(result.current.data).toEqual({ done: true });

    await advance(1000);
    expect(calls).toBe(2);
  });

  describe("option changes while mounted", () => {
    function payloadRecordingDispatcher(): { dispatcher: Dispatcher; payloads: unknown[] } {
      const payloads: unknown[] = [];
      const query = (async (_type: string, payload: unknown) => {
        payloads.push(payload);
        return { isSuccess: true, data: { n: payloads.length } };
      }) as unknown as QueryFn;
      return { dispatcher: makeDispatcher(query), payloads };
    }

    test("a payload change refetches with the new payload and the interval keeps ticking with it, on a single timer", async () => {
      const { dispatcher, payloads } = payloadRecordingDispatcher();
      const { rerender } = renderHook(
        ({ id }: { readonly id: number }) =>
          useQuery(QUERY_TYPE, { id }, { refetchIntervalMs: 1000 }),
        { wrapper: wrapperFor(dispatcher), initialProps: { id: 1 } },
      );
      await advance(0);
      expect(payloads).toEqual([{ id: 1 }]);

      rerender({ id: 2 });
      await advance(0);
      expect(payloads).toEqual([{ id: 1 }, { id: 2 }]);

      // One tick per interval: a leftover timer from the old payload would add a second call.
      await advance(1000);
      expect(payloads).toEqual([{ id: 1 }, { id: 2 }, { id: 2 }]);
      await advance(1000);
      expect(payloads).toEqual([{ id: 1 }, { id: 2 }, { id: 2 }, { id: 2 }]);
    });

    test("enabled true to false stops the ticks", async () => {
      const { dispatcher, calls } = countingDispatcher();
      const { rerender } = renderHook(
        ({ enabled }: { readonly enabled: boolean }) =>
          useQuery(QUERY_TYPE, {}, { enabled, refetchIntervalMs: 1000 }),
        { wrapper: wrapperFor(dispatcher), initialProps: { enabled: true } },
      );
      await advance(0);
      await advance(1000);
      const before = calls();
      expect(before).toBe(2);

      rerender({ enabled: false });
      await advance(5000);
      expect(calls()).toBe(before);
    });

    test("an interval change replaces the old frequency", async () => {
      const { dispatcher, calls } = countingDispatcher();
      const { rerender } = renderHook(
        ({ ms }: { readonly ms: number }) => useQuery(QUERY_TYPE, {}, { refetchIntervalMs: ms }),
        { wrapper: wrapperFor(dispatcher), initialProps: { ms: 1000 } },
      );
      await advance(0);
      expect(calls()).toBe(1);

      rerender({ ms: 250 });
      await advance(0);
      const afterRerender = calls();

      // Stepped, so each tick's fetch settles before the next tick fires.
      for (let tick = 0; tick < 4; tick += 1) await advance(250);
      expect(calls() - afterRerender).toBe(4);

      await advance(250);
      expect(calls() - afterRerender).toBe(5);
    });

    test("a fetch aborted by a payload change does not leave polling blocked", async () => {
      const payloads: unknown[] = [];
      const query = (async (_type: string, payload: unknown, opts?: { signal?: AbortSignal }) => {
        payloads.push(payload);
        if ((payload as { id: number }).id === 1) {
          // Hangs until the hook aborts it, like a slow request that gets superseded.
          await new Promise<void>((resolve) => {
            opts?.signal?.addEventListener("abort", () => resolve());
          });
          return { isSuccess: false, error: { code: "aborted", message: "aborted", i18nKey: "x" } };
        }
        return { isSuccess: true, data: { done: true } };
      }) as unknown as QueryFn;
      const { rerender } = renderHook(
        ({ id }: { readonly id: number }) =>
          useQuery(QUERY_TYPE, { id }, { refetchIntervalMs: 1000 }),
        { wrapper: wrapperFor(makeDispatcher(query)), initialProps: { id: 1 } },
      );
      await advance(0);
      expect(payloads).toEqual([{ id: 1 }]);

      rerender({ id: 2 });
      await advance(0);
      expect(payloads).toEqual([{ id: 1 }, { id: 2 }]);

      await advance(1000);
      expect(payloads).toEqual([{ id: 1 }, { id: 2 }, { id: 2 }]);
    });
  });

  test("background ticks do not flip loading to true", async () => {
    const { dispatcher, calls } = countingDispatcher();
    const seenLoading: boolean[] = [];
    const { result } = renderHook(
      () => {
        const r = useQuery<{ n: number }>(QUERY_TYPE, {}, { refetchIntervalMs: 1000 });
        seenLoading.push(r.loading);
        return r;
      },
      { wrapper: wrapperFor(dispatcher) },
    );
    await advance(0);
    expect(result.current.loading).toBe(false);
    seenLoading.length = 0;

    await advance(1000);
    await advance(1000);
    expect(calls()).toBe(3);
    expect(result.current.data).toEqual({ n: 3 });
    expect(seenLoading.every((l) => l === false)).toBe(true);
  });
});
