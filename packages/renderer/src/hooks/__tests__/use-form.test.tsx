import { describe, expect, mock, test } from "bun:test";
import type { Dispatcher, WriteResult } from "@cosmicdrift/kumiko-headless";
import { act, renderHook } from "@testing-library/react";
import { useForm } from "../use-form";

function makeDispatcher(response?: WriteResult): Dispatcher & {
  readonly writeSpy: ReturnType<typeof mock>;
} {
  const writeSpy = mock(
    async () => response ?? ({ isSuccess: true, data: { id: "srv-1" } } as WriteResult),
  );
  return {
    writeSpy,
    write: writeSpy as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    async *stream() {},
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

describe("useForm — mounted without a DispatcherProvider", () => {
  test("does not throw on mount — fw#1999 regression", () => {
    const { result } = renderHook(() =>
      useForm({ initial: { title: "" }, submit: { type: "app:write:task:create" } }),
    );

    expect(result.current.snapshot.values.title).toBe("");
  });

  test("submit() without an explicit dispatcher returns isSuccess:false instead of crashing the hook", async () => {
    const { result } = renderHook(() =>
      useForm({ initial: { title: "hello" }, submit: { type: "app:write:task:create" } }),
    );

    const submitResult = await result.current.controller.submit();
    expect(submitResult.validationBlocked).toBe(false);
    expect(submitResult.isSuccess).toBe(false);
    if (submitResult.isSuccess || submitResult.validationBlocked) {
      throw new Error("expected write failure");
    }
    expect(submitResult.error.message).toMatch(/submit\(\) called without a dispatcher/);
  });

  test("submit() with an explicit dispatcher still works without a provider", async () => {
    const dispatcher = makeDispatcher();
    const { result } = renderHook(() =>
      useForm({
        initial: { title: "hello" },
        submit: { type: "app:write:task:create", dispatcher },
      }),
    );

    await act(async () => {
      await result.current.controller.submit();
    });

    expect(dispatcher.writeSpy).toHaveBeenCalledWith("app:write:task:create", { title: "hello" });
  });
});
