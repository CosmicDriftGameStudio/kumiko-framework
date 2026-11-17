import { describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { Dispatcher, WriteResult } from "../../headless/index.ts";
import { useForm } from "../use-form.ts";
import { createMockDispatcher, type MockWriteHandler } from "../../testing.ts";

function makeDispatcher(response?: WriteResult): Dispatcher & {
  readonly writeSpy: ReturnType<typeof mock>;
} {
  const writeSpy = mock<MockWriteHandler>(
    async () => response ?? ({ isSuccess: true, data: { id: "srv-1" } } as WriteResult),
  );
  return {
    ...createMockDispatcher({
      write: writeSpy,
      query: async () => ({ isSuccess: true, data: null }),
      batch: async () => ({ isSuccess: true, results: [] }),
    }),
    writeSpy,
  };
}

describe("useForm — mounted without a DispatcherProvider", () => {
  test("does not throw on mount", () => {
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

    expect(dispatcher.writeSpy).toHaveBeenCalledWith(
      "app:write:task:create",
      { title: "hello" },
      expect.anything(),
    );
  });
});
