// In-memory dispatcher for writeform-section/e2e. Implements the dispatcher
// interface from @cosmicdrift/kumiko-headless without the HTTP layer — no
// form-draft, no batch state, just the QNs this recipe's two screens need:
//
//   - "note-desk:query:note:detail" — the projectionDetail screen's own
//     query, returns the same fixed row the real server handler returns.
//   - "note-desk:write:note:comment" — the writeForm section's handler.
//   - "note-desk:write:note:create" — the entityEdit screen's create submit
//     (r.crud's generated create handler).
//
// Both writes mirror their payload into localStorage under an exported key
// so the spec can read what actually reached the "server" via
// page.evaluate(), without reaching into this module's closure.

import type {
  BatchResult,
  Command,
  Dispatcher,
  DispatcherStatus,
  PendingFile,
  PendingWrite,
  QueryOpts,
  QueryResult,
  Store,
  WriteOpts,
  WriteResult,
} from "@cosmicdrift/kumiko-headless";

const QUERY_NOTE_DETAIL = "note-desk:query:note:detail";
const WRITE_NOTE_COMMENT = "note-desk:write:note:comment";
const WRITE_NOTE_CREATE = "note-desk:write:note:create";

// Same fixed values as the real server handler (src/feature.ts's
// "note:detail" query handler) — only `id` varies with the request.
const NOTE_DETAIL_FIELDS = {
  title: "Sample note",
  category: "question",
  priority: 2,
  body: "...",
};

export const CREATED_COMMENTS_KEY = "mock-created-comments";
export const CREATED_NOTES_KEY = "mock-created-notes";

const ONLINE_STORE: Store<DispatcherStatus> = {
  getSnapshot: () => "online",
  subscribe: () => () => {},
};

function mirrorToStorage(key: string, payload: unknown): void {
  const list = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
  list.push(payload);
  localStorage.setItem(key, JSON.stringify(list));
}

export function createMockDispatcher(): Dispatcher {
  async function write<TData = unknown>(
    type: string,
    payload: unknown,
    _opts?: WriteOpts,
  ): Promise<WriteResult<TData>> {
    if (type === WRITE_NOTE_COMMENT) {
      mirrorToStorage(CREATED_COMMENTS_KEY, payload);
      return { isSuccess: true, data: null as unknown as TData };
    }
    if (type === WRITE_NOTE_CREATE) {
      mirrorToStorage(CREATED_NOTES_KEY, payload);
      return { isSuccess: true, data: { id: "note-new", ...(payload as object) } as TData };
    }
    throw new Error(`mock-dispatcher: unsupported write qn "${type}"`);
  }

  async function query<TData = unknown>(
    type: string,
    payload: unknown,
    _opts?: QueryOpts,
  ): Promise<QueryResult<TData>> {
    if (type === QUERY_NOTE_DETAIL) {
      const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary mock-dispatcher wire payload
      const id = (data["id"] as string | undefined) ?? "note-1";
      return { isSuccess: true, data: { id, ...NOTE_DETAIL_FIELDS } as unknown as TData };
    }
    throw new Error(`mock-dispatcher: unsupported query qn "${type}"`);
  }

  async function batch(commands: readonly Command[], opts?: WriteOpts): Promise<BatchResult> {
    const results: WriteResult[] = [];
    for (const cmd of commands) results.push(await write(cmd.type, cmd.payload, opts));
    return { isSuccess: true, results };
  }

  return {
    write,
    query,
    batch,
    statusStore: ONLINE_STORE,
    async *stream() {},
    pendingWrites: (): readonly PendingWrite[] => [],
    pendingFiles: (): readonly PendingFile[] => [],
  };
}
