import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { useAiTextAction, useCompletion } from "../use-ai-text";

function makeDispatcher(query: Dispatcher["query"]): Dispatcher {
  return {
    query,
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
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

describe("useAiTextAction", () => {
  test("success → state='success', result carries the text", async () => {
    const dispatcher = makeDispatcher((async (_type: string, payload: unknown) => ({
      isSuccess: true,
      data: {
        type: "text",
        text: `echo:${(payload as { text: string }).text}`,
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    })) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useAiTextAction(), { wrapper: wrapperFor(dispatcher) });

    expect(result.current.state).toBe("idle");
    await act(async () => {
      await result.current.run({ mode: "correct", text: "hi" });
    });

    expect(result.current.state).toBe("success");
    expect(result.current.result).toEqual({
      type: "text",
      text: "echo:hi",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(result.current.error).toBeNull();
  });

  test("cap_exceeded error → state='cap-exceeded'", async () => {
    const dispatcher = makeDispatcher((async () => ({
      isSuccess: false,
      error: { code: "cap_exceeded", message: "capped", i18nKey: "errors.cap" },
    })) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useAiTextAction(), { wrapper: wrapperFor(dispatcher) });

    await act(async () => {
      await result.current.run({ mode: "correct", text: "hi" });
    });

    expect(result.current.state).toBe("cap-exceeded");
    expect(result.current.error?.code).toBe("cap_exceeded");
  });

  test("feature_disabled error → state='unavailable' (graceful degradation)", async () => {
    const dispatcher = makeDispatcher((async () => ({
      isSuccess: false,
      error: { code: "feature_disabled", message: "off", i18nKey: "errors.disabled" },
    })) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useAiTextAction(), { wrapper: wrapperFor(dispatcher) });

    await act(async () => {
      await result.current.run({ mode: "complete", text: "hi" });
    });

    expect(result.current.state).toBe("unavailable");
  });

  test("reset clears state/result/error back to idle", async () => {
    const dispatcher = makeDispatcher((async () => ({
      isSuccess: false,
      error: { code: "conflict", message: "boom", i18nKey: "errors.conflict" },
    })) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useAiTextAction(), { wrapper: wrapperFor(dispatcher) });
    await act(async () => {
      await result.current.run({ mode: "correct", text: "hi" });
    });
    expect(result.current.state).toBe("error");

    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });
});

describe("useCompletion", () => {
  test("debounces requestCompletion — only the last call within the window fires", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async (_type: string, payload: unknown) => {
      calls++;
      return {
        isSuccess: true,
        data: {
          type: "text",
          text: `suggestion for "${(payload as { text: string }).text}"`,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      };
    }) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useCompletion(20), { wrapper: wrapperFor(dispatcher) });

    act(() => {
      result.current.requestCompletion("a");
      result.current.requestCompletion("ab");
      result.current.requestCompletion("abc");
    });

    await waitFor(() => expect(result.current.suggestion).not.toBeNull(), { timeout: 1000 });

    expect(calls).toBe(1);
    expect(result.current.suggestion).toBe('suggestion for "abc"');
  });

  test("empty text resets immediately without a request", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls++;
      return {
        isSuccess: true,
        data: { type: "text", text: "x", usage: { inputTokens: 1, outputTokens: 1 } },
      };
    }) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useCompletion(10), { wrapper: wrapperFor(dispatcher) });

    act(() => {
      result.current.requestCompletion("");
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(calls).toBe(0);
    expect(result.current.suggestion).toBeNull();
  });

  test("clear cancels a pending debounce and resets the suggestion", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls++;
      return {
        isSuccess: true,
        data: { type: "text", text: "x", usage: { inputTokens: 1, outputTokens: 1 } },
      };
    }) as unknown as Dispatcher["query"]);

    const { result } = renderHook(() => useCompletion(30), { wrapper: wrapperFor(dispatcher) });

    act(() => {
      result.current.requestCompletion("hello");
    });
    act(() => result.current.clear());
    await new Promise((r) => setTimeout(r, 60));

    expect(calls).toBe(0);
    expect(result.current.suggestion).toBeNull();
  });
});

