import { describe, expect, test } from "bun:test";
import type { Dispatcher, DispatcherError } from "@cosmicdrift/kumiko-headless";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { useStreamHandler } from "../use-stream-handler";

function makeDispatcher(streamImpl: unknown): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    stream: streamImpl as Dispatcher["stream"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function wrapperFor(dispatcher: Dispatcher) {
  return ({ children }: { readonly children: ReactNode }) => (
    <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
  );
}

describe("useStreamHandler", () => {
  test("start accumulates chunks then status=done", async () => {
    const dispatcher = makeDispatcher(async function* () {
      yield { i: 0 };
      yield { i: 1 };
    });

    const { result } = renderHook(() => useStreamHandler<{ i: number }>("f:stream:x:tail"), {
      wrapper: wrapperFor(dispatcher),
    });

    await act(async () => {
      await result.current.start({ count: 2 });
    });

    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.chunks).toEqual([{ i: 0 }, { i: 1 }]);
    expect(result.current.error).toBeNull();
  });

  test("stream error sets status=error and error envelope", async () => {
    const err: DispatcherError = {
      code: "access_denied",
      httpStatus: 403,
      i18nKey: "errors.access",
      message: "denied",
    };
    const dispatcher = makeDispatcher(async function* () {
      yield* []; // satisfy generator shape; error is the only outcome
      throw err;
    });

    const { result } = renderHook(() => useStreamHandler("f:stream:x:tail"), {
      wrapper: wrapperFor(dispatcher),
    });

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.code).toBe("access_denied");
  });

  test("abort during stream leaves status without late done", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const dispatcher = makeDispatcher(async function* (
      _t: string,
      _p: unknown,
      opts?: { signal?: AbortSignal },
    ) {
      yield { i: 0 };
      await gate;
      if (opts?.signal?.aborted) {
        const e = { code: "aborted", httpStatus: 0, i18nKey: "x", message: "aborted" };
        throw e;
      }
      yield { i: 1 };
    });

    const { result } = renderHook(() => useStreamHandler<{ i: number }>("f:stream:x:tail"), {
      wrapper: wrapperFor(dispatcher),
    });

    let started!: Promise<void>;
    act(() => {
      started = result.current.start();
    });
    await waitFor(() => expect(result.current.chunks).toEqual([{ i: 0 }]));
    act(() => result.current.abort());
    release();
    await started;
    expect(result.current.chunks).toEqual([{ i: 0 }]);
    expect(result.current.status).not.toBe("done");
  });
});
