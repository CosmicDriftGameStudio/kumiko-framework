import { describe, expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { useMutation } from "../use-mutation.ts";
import { createMockDispatcher } from "../../testing.ts";

function wrapperFor(dispatcher: Dispatcher) {
  return ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("useMutation", () => {
  test("Success sets data, toggles pending, and passes through Result", async () => {
    let resolve: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    const dispatcher = createMockDispatcher({ write: async (_type: string, payload: unknown) => {
      await gate;
      return { isSuccess: true, data: { echoed: payload } };
    } });

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

  test("Failure sets error, reset clears it", async () => {
    const dispatcher = createMockDispatcher({ write: async () => ({
      isSuccess: false,
      error: { code: "conflict", message: "boom", i18nKey: "errors.conflict" },
    }) });

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
