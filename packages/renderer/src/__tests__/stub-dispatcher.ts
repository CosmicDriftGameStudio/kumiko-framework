import type { Dispatcher } from "@cosmicdrift/kumiko-headless";

export type RecordedWrite = { readonly type: string; readonly payload: unknown };

// One shared Dispatcher fake so a Dispatcher interface change needs a single
// edit. Writes go through `overrides.write` when given but are always
// recorded.
export function stubDispatcher(overrides: Partial<Dispatcher> = {}): {
  dispatcher: Dispatcher;
  writes: RecordedWrite[];
} {
  const writes: RecordedWrite[] = [];
  const writeImpl: Dispatcher["write"] =
    overrides.write ??
    ((async () => ({ isSuccess: true, data: { id: "n1" } })) as unknown as Dispatcher["write"]);
  const dispatcher: Dispatcher = {
    query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
    ...overrides,
    write: (async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return (writeImpl as (type: string, payload: unknown) => unknown)(type, payload);
    }) as unknown as Dispatcher["write"],
  };
  return { dispatcher, writes };
}
