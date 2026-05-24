import { describe, expect, test } from "bun:test";
import { createStore } from "../../store";
import type {
  BatchResult,
  Command,
  Dispatcher,
  DispatcherStatus,
  PendingFile,
  PendingWrite,
  QueryResult,
  WriteResult,
} from "../types";

// A minimal fake dispatcher — proves the Dispatcher interface is sufficient
// to implement a synchronous in-memory client, and pins the public shape of
// WriteResult / QueryResult / BatchResult so a PR that renames or reshapes
// a field breaks this file loud.
//
// The fake records every call, so the test can assert on the exact
// sequence without re-exercising real HTTP. Block 2's form-controller uses
// this fake as its default test double.
function createFakeDispatcher(options?: {
  readonly writeResponses?: Record<string, WriteResult>;
  readonly queryResponses?: Record<string, QueryResult>;
}): Dispatcher & {
  readonly calls: ReadonlyArray<{
    kind: "write" | "query" | "batch";
    type?: string;
    payload?: unknown;
  }>;
  setStatus(next: DispatcherStatus): void;
} {
  const calls: Array<{ kind: "write" | "query" | "batch"; type?: string; payload?: unknown }> = [];
  const statusStore = createStore<DispatcherStatus>("online");
  const pendingWritesStore: PendingWrite[] = [];
  const pendingFilesStore: PendingFile[] = [];

  return {
    calls,
    async write<TData>(type: string, payload: unknown) {
      calls.push({ kind: "write", type, payload });
      const response = options?.writeResponses?.[type];
      return (response ?? {
        isSuccess: true,
        data: { id: `fake-${calls.length}` },
      }) as WriteResult<TData>;
    },
    async query<TData>(type: string, payload: unknown) {
      calls.push({ kind: "query", type, payload });
      const response = options?.queryResponses?.[type];
      return (response ?? { isSuccess: true, data: null }) as QueryResult<TData>;
    },
    async batch(commands) {
      calls.push({ kind: "batch", payload: commands });
      const results: WriteResult[] = commands.map((_, i) => ({
        isSuccess: true as const,
        data: { id: `fake-batch-${i}` },
      }));
      const result: BatchResult = { isSuccess: true, results };
      return result;
    },
    statusStore,
    pendingWrites: () => pendingWritesStore,
    pendingFiles: () => pendingFilesStore,
    setStatus(next) {
      statusStore.setState(next);
    },
  };
}

describe("Dispatcher contract", () => {
  test("write() records the call and returns the configured response", async () => {
    const disp = createFakeDispatcher({
      writeResponses: {
        "app:write:task:create": { isSuccess: true, data: { id: "t-1", title: "hello" } },
      },
    });

    const result = await disp.write("app:write:task:create", { title: "hello" });

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect((result.data as { id: string }).id).toBe("t-1");
    }
    expect(disp.calls).toHaveLength(1);
    expect(disp.calls[0]).toEqual({
      kind: "write",
      type: "app:write:task:create",
      payload: { title: "hello" },
    });
  });

  test("write() failure shape carries code + message + optional field issues", async () => {
    const disp = createFakeDispatcher({
      writeResponses: {
        "app:write:task:create": {
          isSuccess: false,
          error: {
            code: "validation_error",
            httpStatus: 400,
            i18nKey: "errors.validation.failed",
            message: "Validation failed",
            details: {
              fields: [
                { path: "title", code: "too_small", i18nKey: "errors.validation.too_small" },
              ],
            },
          },
        },
      },
    });

    const result = await disp.write("app:write:task:create", { title: "" });

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.details?.fields?.[0]?.path).toBe("title");
    }
  });

  test("batch() returns one result per command, in order", async () => {
    const disp = createFakeDispatcher();
    const commands: readonly Command[] = [
      { type: "app:write:task:create", payload: { title: "a" } },
      { type: "app:write:task:create", payload: { title: "b" } },
      { type: "app:write:task:create", payload: { title: "c" } },
    ];

    const result = await disp.batch(commands);

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      expect(result.results).toHaveLength(3);
      for (const r of result.results) {
        expect(r.isSuccess).toBe(true);
      }
    }
  });

  test("statusStore fires on transitions and unsubscribes cleanly", () => {
    const disp = createFakeDispatcher();
    const seen: DispatcherStatus[] = [];

    const unsubscribe = disp.statusStore.subscribe(() => seen.push(disp.statusStore.getSnapshot()));
    disp.setStatus("offline");
    disp.setStatus("syncing");
    unsubscribe();
    disp.setStatus("online");

    expect(seen).toEqual(["offline", "syncing"]);
  });

  test("pending queues are empty by default (live-dispatcher semantic)", () => {
    const disp = createFakeDispatcher();

    expect(disp.pendingWrites()).toEqual([]);
    expect(disp.pendingFiles()).toEqual([]);
  });
});
