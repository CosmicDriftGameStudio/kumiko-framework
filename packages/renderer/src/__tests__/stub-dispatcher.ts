import type { Dispatcher } from "../headless/index.ts";
import {
  createMockDispatcher,
  type MockDispatcherOptions,
  type MockWriteHandler,
} from "../testing.ts";

export type RecordedWrite = { readonly type: string; readonly payload: unknown };

// Writes go through `options.write` when given but are always recorded.
export function stubDispatcher(options: MockDispatcherOptions = {}): {
  dispatcher: Dispatcher;
  writes: RecordedWrite[];
} {
  const writes: RecordedWrite[] = [];
  const write: MockWriteHandler = (type, payload, opts) => {
    writes.push({ type, payload });
    return options.write
      ? options.write(type, payload, opts)
      : { isSuccess: true, data: { id: "n1" } };
  };
  return { dispatcher: createMockDispatcher({ ...options, write }), writes };
}
