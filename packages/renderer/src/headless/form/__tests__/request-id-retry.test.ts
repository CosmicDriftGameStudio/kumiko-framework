import { describe, expect, test } from "bun:test";
import type {
  Dispatcher,
  DispatcherError,
  WriteOpts,
  WriteResult,
} from "../../dispatcher/index.ts";
import { createStore } from "../../store/index.ts";
import { createFormController } from "../form-controller.ts";

const NETWORK_ERROR: DispatcherError = {
  code: "network_error",
  httpStatus: 0,
  i18nKey: "dispatcher.errors.network",
  message: "offline",
};
const ABORTED: DispatcherError = { ...NETWORK_ERROR, code: "aborted" };
const SERVER_ERROR: DispatcherError = {
  code: "boom",
  httpStatus: 500,
  i18nKey: "errors.internal",
  message: "boom",
};

function scriptedDispatcher(results: readonly WriteResult[]): {
  readonly dispatcher: Dispatcher;
  readonly requestIds: (string | undefined)[];
} {
  const requestIds: (string | undefined)[] = [];
  let call = 0;
  const dispatcher: Dispatcher = {
    async write<TData>(_type: string, _payload: unknown, opts?: WriteOpts) {
      requestIds.push(opts?.requestId);
      const result = results[call++] ?? { isSuccess: true, data: {} };
      return result as WriteResult<TData>;
    },
    async query<TData>() {
      return { isSuccess: true, data: null } as unknown as { isSuccess: true; data: TData };
    },
    async batch() {
      return { isSuccess: true, results: [] };
    },
    async *stream() {},
    statusStore: createStore("online"),
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
  return { dispatcher, requestIds };
}

function formWith(dispatcher: Dispatcher) {
  return createFormController({
    initial: { title: "a" },
    submit: { type: "app:write:task:create", dispatcher },
  });
}

describe("form-controller requestId across retries", () => {
  test("every submit sends a requestId", async () => {
    const { dispatcher, requestIds } = scriptedDispatcher([]);
    await formWith(dispatcher).submit();
    expect(requestIds[0]).toBeString();
  });

  test.each([
    ["network failure", NETWORK_ERROR],
    ["abort", ABORTED],
  ])("identical retry after %s reuses the requestId", async (_name, error) => {
    const { dispatcher, requestIds } = scriptedDispatcher([{ isSuccess: false, error }]);
    const form = formWith(dispatcher);
    await form.submit();
    await form.submit();
    expect(requestIds[1]).toBe(requestIds[0]);
  });

  test("retry after a server error gets a fresh requestId", async () => {
    const { dispatcher, requestIds } = scriptedDispatcher([
      { isSuccess: false, error: SERVER_ERROR },
    ]);
    const form = formWith(dispatcher);
    await form.submit();
    await form.submit();
    expect(requestIds[1]).not.toBe(requestIds[0]);
  });

  test("changed values after a network failure get a fresh requestId", async () => {
    const { dispatcher, requestIds } = scriptedDispatcher([
      { isSuccess: false, error: NETWORK_ERROR },
    ]);
    const form = formWith(dispatcher);
    await form.submit();
    form.setField("title", "b");
    await form.submit();
    expect(requestIds[1]).not.toBe(requestIds[0]);
  });

  test("a successful retry consumes the key; the next submit is fresh", async () => {
    const { dispatcher, requestIds } = scriptedDispatcher([
      { isSuccess: false, error: NETWORK_ERROR },
      { isSuccess: true, data: {} },
    ]);
    const form = formWith(dispatcher);
    await form.submit();
    await form.submit();
    form.setField("title", "b");
    form.setField("title", "a");
    await form.submit();
    expect(requestIds[2]).not.toBe(requestIds[1]);
  });
});
