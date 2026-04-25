// @vitest-environment jsdom
import type { Dispatcher, DispatcherError } from "@kumiko/headless";
import { DispatcherProvider, useQuery } from "@kumiko/renderer";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "./test-utils";

function makeDispatcher(
  queryFn: Dispatcher["query"] = (async () => ({
    isSuccess: true,
    data: [],
  })) as unknown as Dispatcher["query"],
): Dispatcher {
  return {
    write: async () => ({ isSuccess: true, data: {} }) as never,
    query: queryFn,
    batch: async () => ({ isSuccess: true, results: [] }) as never,
    status: () => "online",
    subscribeStatus: () => () => {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function wrap(dispatcher: Dispatcher) {
  return ({ children }: { children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("useQuery", () => {
  test("loads on mount; populates data, flips loading to false", async () => {
    const query = vi.fn(
      async () => ({ isSuccess: true, data: [{ id: "1" }, { id: "2" }] }) as never,
    );
    const dispatcher = makeDispatcher(query as unknown as Dispatcher["query"]);
    const { result } = renderHook(() => useQuery("task:list", {}), {
      wrapper: wrap(dispatcher),
    });

    // First tick: loading state.
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.current.error).toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  test("server error surfaces via `error`; data stays null", async () => {
    const err: DispatcherError = {
      code: "not_found",
      httpStatus: 404,
      i18nKey: "errors.not_found",
      message: "no",
    };
    const query = vi.fn(async () => ({ isSuccess: false, error: err }) as never);
    const { result } = renderHook(() => useQuery("task:list", {}), {
      wrapper: wrap(makeDispatcher(query as unknown as Dispatcher["query"])),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error?.code).toBe("not_found");
  });

  test("enabled:false skips the auto-fetch until refetch is called", async () => {
    const query = vi.fn(async () => ({ isSuccess: true, data: ["hi"] }) as never);
    const { result } = renderHook(() => useQuery("task:list", {}, { enabled: false }), {
      wrapper: wrap(makeDispatcher(query as unknown as Dispatcher["query"])),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(query).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });
    expect(query).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual(["hi"]);
  });

  test("refetch re-runs and replaces data (after-mutation reload pattern)", async () => {
    let callCount = 0;
    const query = vi.fn(async () => {
      callCount += 1;
      return { isSuccess: true, data: [callCount] } as never;
    });
    const { result } = renderHook(() => useQuery<number[]>("task:list", {}), {
      wrapper: wrap(makeDispatcher(query as unknown as Dispatcher["query"])),
    });

    await waitFor(() => expect(result.current.data).toEqual([1]));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual([2]);
  });
});
