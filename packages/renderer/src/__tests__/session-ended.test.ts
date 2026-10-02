import { describe, expect, test } from "bun:test";
import type { Dispatcher, DispatcherError } from "@cosmicdrift/kumiko-headless";
import {
  createSessionEndedSignal,
  isSessionEndedError,
  withSessionEndedDetection,
} from "../session/session-ended.js";

function errorOf(httpStatus: number, code: string): DispatcherError {
  return { code, httpStatus, i18nKey: `errors.${code}`, message: code };
}

type StubDispatcher = {
  write: () => Promise<unknown>;
  query: () => Promise<unknown>;
  batch: () => Promise<unknown>;
  stream: () => AsyncGenerator<unknown, void, undefined>;
};

// The real Dispatcher methods are generic over the payload type, which a
// concrete stub cannot satisfy — one cast at this test boundary instead of
// per stub.
function createDispatcher(overrides: Partial<StubDispatcher>): Dispatcher {
  const stub = {
    write: () => Promise.resolve({ isSuccess: true, data: null }),
    query: () => Promise.resolve({ isSuccess: true, data: null }),
    batch: () => Promise.resolve({ isSuccess: true, results: [] }),
    async *stream() {},
    statusStore: { getSnapshot: () => "online", subscribe: () => () => {} },
    pendingWrites: () => [],
    pendingFiles: () => [],
    ...overrides,
  };
  return stub as unknown as Dispatcher;
}

function setup(overrides: Partial<StubDispatcher>) {
  const signal = createSessionEndedSignal();
  let notifications = 0;
  signal.subscribe(() => {
    notifications++;
  });
  const dispatcher = withSessionEndedDetection(createDispatcher(overrides), signal);
  return { dispatcher, notifications: () => notifications };
}

describe("isSessionEndedError", () => {
  test.each(["session_invalid", "invalid_token", "missing_token", "unauthenticated"])(
    "401 %s ends the session",
    (code) => {
      expect(isSessionEndedError(errorOf(401, code))).toBe(true);
    },
  );

  test("401 with a foreign code does not", () => {
    expect(isSessionEndedError(errorOf(401, "something_else"))).toBe(false);
  });

  test("403 does not, even with a session code", () => {
    expect(isSessionEndedError(errorOf(403, "session_invalid"))).toBe(false);
  });
});

describe("withSessionEndedDetection", () => {
  test("notifies on a 401 session_invalid write and returns the result unchanged", async () => {
    const failure = { isSuccess: false as const, error: errorOf(401, "session_invalid") };
    const { dispatcher, notifications } = setup({ write: () => Promise.resolve(failure) });

    expect(await dispatcher.write("x", {})).toBe(failure);
    expect(notifications()).toBe(1);
  });

  test("notifies on query and batch failures", async () => {
    const error = errorOf(401, "invalid_token");
    const { dispatcher, notifications } = setup({
      query: () => Promise.resolve({ isSuccess: false, error }),
      batch: () => Promise.resolve({ isSuccess: false, error, failedIndex: 0, results: [] }),
    });

    await dispatcher.query("x", {});
    await dispatcher.batch([]);
    expect(notifications()).toBe(2);
  });

  test("does not notify for a foreign 401 code, a 403 or a success", async () => {
    const foreign = { isSuccess: false as const, error: errorOf(401, "other") };
    const forbidden = { isSuccess: false as const, error: errorOf(403, "access_denied") };
    const success = { isSuccess: true as const, data: 1 };
    const results = [foreign, forbidden, success];
    let call = 0;
    const { dispatcher, notifications } = setup({
      write: () => Promise.resolve(results[call++] ?? success),
    });

    expect(await dispatcher.write("x", {})).toBe(foreign);
    expect(await dispatcher.write("x", {})).toBe(forbidden);
    expect(await dispatcher.write("x", {})).toBe(success);
    expect(notifications()).toBe(0);
  });

  test("stream passes chunks through unchanged", async () => {
    const { dispatcher, notifications } = setup({
      async *stream() {
        yield 1;
        yield 2;
      },
    });

    const chunks: unknown[] = [];
    for await (const chunk of dispatcher.stream("x", {})) chunks.push(chunk);

    expect(chunks).toEqual([1, 2]);
    expect(notifications()).toBe(0);
  });

  test("stream that throws a 401 session error notifies and rethrows", async () => {
    const error = errorOf(401, "session_invalid");
    const { dispatcher, notifications } = setup({
      // biome-ignore lint/correctness/useYield: throws before the first chunk
      async *stream() {
        throw error;
      },
    });

    await expect(dispatcher.stream("x", {}).next()).rejects.toBe(error);
    expect(notifications()).toBe(1);
  });

  test("stream that throws a non-session error does not notify", async () => {
    const { dispatcher, notifications } = setup({
      // biome-ignore lint/correctness/useYield: throws before the first chunk
      async *stream() {
        throw new Error("boom");
      },
    });

    await expect(dispatcher.stream("x", {}).next()).rejects.toThrow("boom");
    expect(notifications()).toBe(0);
  });

  test("a stopped subscription is not notified", () => {
    const signal = createSessionEndedSignal();
    let notifications = 0;
    const unsubscribe = signal.subscribe(() => {
      notifications++;
    });
    unsubscribe();
    signal.notify();
    expect(notifications).toBe(0);
  });
});
