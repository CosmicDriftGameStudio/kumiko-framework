import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { useMutation } from "../use-mutation";

function makeDispatcher(write: Dispatcher["write"]): Dispatcher {
  return {
    write,
    query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
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

describe("useMutation", () => {
  test("Success setzt data, pending toggelt, Result wird durchgereicht", async () => {
    let resolve: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    const dispatcher = makeDispatcher((async (_type: string, payload: unknown) => {
      await gate;
      return { isSuccess: true, data: { echoed: payload } };
    }) as unknown as Dispatcher["write"]);

    const { result } = renderHook(() => useMutation<{ echoed: unknown }>("f:write:x:create"), {
      wrapper: wrapperFor(dispatcher),
    });

    expect(result.current.pending).toBe(false);
    let outcome: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    act(() => {
      void result.current.mutate({ name: "a" }).then((r) => {
        outcome = r;
      });
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    act(() => resolve?.());
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.data).toEqual({ echoed: { name: "a" } });
    expect(result.current.error).toBeNull();
    expect(outcome?.isSuccess).toBe(true);
  });

  test("Failure setzt error, reset räumt auf", async () => {
    const dispatcher = makeDispatcher((async () => ({
      isSuccess: false,
      error: { code: "conflict", message: "boom", i18nKey: "errors.conflict" },
    })) as unknown as Dispatcher["write"]);

    const { result } = renderHook(() => useMutation("f:write:x:create"), {
      wrapper: wrapperFor(dispatcher),
    });

    await act(async () => {
      await result.current.mutate({});
    });
    expect(result.current.error?.code).toBe("conflict");
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });
});
