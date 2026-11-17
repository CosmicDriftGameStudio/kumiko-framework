import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import type { Dispatcher, DispatcherError } from "../../headless/index.ts";
import { DispatcherProvider, useQuery } from "../../index.ts";
import {
  act,
  createMockDispatcher,
  type MockQueryHandler,
  renderHook,
  waitFor,
} from "./test-utils.tsx";

function wrap(dispatcher: Dispatcher) {
  return ({ children }: { children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("useQuery", () => {
  test("loads on mount; populates data, flips loading to false", async () => {
    const query = mock<MockQueryHandler>(
      async () => ({ isSuccess: true, data: [{ id: "1" }, { id: "2" }] }) as never,
    );
    const dispatcher = createMockDispatcher({ query: query });
    const { result } = renderHook(() => useQuery("task:list", {}), {
      wrapper: wrap(dispatcher),
    });

    // First tick: loading state.
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.current.error).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("server error surfaces via `error`; data stays null", async () => {
    const err: DispatcherError = {
      code: "not_found",
      httpStatus: 404,
      i18nKey: "errors.not_found",
      message: "no",
    };
    const query = mock<MockQueryHandler>(async () => ({ isSuccess: false, error: err }));
    const { result } = renderHook(() => useQuery("task:list", {}), {
      wrapper: wrap(createMockDispatcher({ query: query })),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error?.code).toBe("not_found");
  });

  test("enabled:false skips the auto-fetch until refetch is called", async () => {
    const query = mock<MockQueryHandler>(async () => ({ isSuccess: true, data: ["hi"] }));
    const { result } = renderHook(() => useQuery("task:list", {}, { enabled: false }), {
      wrapper: wrap(createMockDispatcher({ query: query })),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(query).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(["hi"]);
  });

  test("refetch re-runs and replaces data (after-mutation reload pattern)", async () => {
    let callCount = 0;
    const query = mock<MockQueryHandler>(async () => {
      callCount += 1;
      return { isSuccess: true, data: [callCount] } as never;
    });
    const { result } = renderHook(() => useQuery<number[]>("task:list", {}), {
      wrapper: wrap(createMockDispatcher({ query: query })),
    });

    await waitFor(() => expect(result.current.data).toEqual([1]));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual([2]);
  });
});
