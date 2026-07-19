import { describe, expect, mock, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider, useMutation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { act, createMockDispatcher, renderHook, waitFor } from "./test-utils";

function wrap(dispatcher: Dispatcher) {
  return ({ children }: { children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("useMutation", () => {
  // #902/2: two overlapping calls on one instance (list-row actions sharing
  // it) must not let the earlier-STARTED, later-RESOLVING call clobber the
  // state set by the later-started, earlier-resolving one.
  test("out-of-order resolution: state reflects the most recently started call, not the most recently resolved one", async () => {
    let resolveFirst: (() => void) | undefined;
    const write = mock(async (_type: string, payload: unknown) => {
      if ((payload as { id: string }).id === "row-1") {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
        return { isSuccess: true, data: { id: "row-1" } };
      }
      return { isSuccess: true, data: { id: "row-2" } };
    });
    const dispatcher = createMockDispatcher({ write: write as unknown as Dispatcher["write"] });
    const { result } = renderHook(() => useMutation("row:update"), {
      wrapper: wrap(dispatcher),
    });

    let firstCallDone: Promise<unknown>;
    let secondCallDone: Promise<unknown>;
    act(() => {
      firstCallDone = result.current.mutate({ id: "row-1" });
    });
    await act(async () => {
      secondCallDone = result.current.mutate({ id: "row-2" });
      // let the second (no-delay) call resolve before the first
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.data).toEqual({ id: "row-2" }));
    expect(result.current.pending).toBe(false); // row-2 (the latest call) already settled

    await act(async () => {
      resolveFirst?.();
      await firstCallDone;
      await secondCallDone;
    });

    // The first call resolving late must not overwrite row-2's state.
    expect(result.current.data).toEqual({ id: "row-2" });
    expect(result.current.pending).toBe(false);
  });

  test("reset() invalidates a still-pending call's late state update", async () => {
    let resolveWrite: (() => void) | undefined;
    const write = mock(async () => {
      await new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      return { isSuccess: true, data: { id: "late" } };
    });
    const dispatcher = createMockDispatcher({ write: write as unknown as Dispatcher["write"] });
    const { result } = renderHook(() => useMutation("row:update"), {
      wrapper: wrap(dispatcher),
    });

    let mutateDone: Promise<unknown>;
    act(() => {
      mutateDone = result.current.mutate({ id: "x" });
    });
    act(() => {
      result.current.reset();
    });
    await act(async () => {
      resolveWrite?.();
      await mutateDone;
    });

    expect(result.current.data).toBeNull();
    expect(result.current.pending).toBe(false);
  });
});
