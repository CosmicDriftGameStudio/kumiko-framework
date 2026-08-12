// In-memory dispatcher for wizard-form/e2e. Implements the dispatcher
// interface from @cosmicdrift/kumiko-headless without the HTTP layer, its
// own lean variant (no import from renderer-web/e2e — its fixtures are
// package-internal, not exported).
//
// Serves two QN formats:
//   - 4-segment CRUD (`<feature>:<write|query>:<entity>:<verb>`) — only
//     `listings:write:listing:create` is needed (no list/detail/
//     update/delete for this spec, YAGNI).
//   - 3-segment form-draft QNs (FormDraftHandlers/FormDraftQueries) —
//     save/discard/get, exactly as packages/bundled-features/src/
//     form-draft/constants.ts defines them.
//
// CRITICAL: the draft state does NOT live in the in-memory closure — a
// real page.reload() throws away the whole JS heap, so an in-memory mock
// would always return null after reload. The mock plays the server here,
// and persistence belongs on the server. Draft blobs land in localStorage
// (Playwright gives each test a fresh BrowserContext — automatically
// test-isolated). The listing CRUD table stays in-memory on purpose: it
// doesn't need to survive a reload, only the draft does.

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

type Row = Record<string, unknown> & { id: string };

type FormDraftBlob = {
  readonly values: Record<string, unknown>;
  readonly stepIndex: number;
  readonly savedAt: string;
};

const FORM_DRAFT_SAVE = "form-draft:write:save";
const FORM_DRAFT_DISCARD = "form-draft:write:discard";
const FORM_DRAFT_GET = "form-draft:query:get";
const FORM_DRAFT_LIST = "form-draft:query:list";
const DRAFT_STORAGE_PREFIX = "mock-form-draft:";
export const CREATED_LISTINGS_KEY = "mock-created-listings";

let nextId = 1;

function generateId(): string {
  return `mock-${nextId++}`;
}

// Exported so the spec builds the same localStorage key instead of
// hardcoding the prefix — a rename here would otherwise silently break
// wizard.spec.ts's draft assertions without any test going red (fw#1911).
export function draftStorageKey(draftKey: string): string {
  return `${DRAFT_STORAGE_PREFIX}${draftKey}`;
}

const ONLINE_STORE: Store<DispatcherStatus> = {
  getSnapshot: () => "online",
  subscribe: () => () => {},
};

export function createMockDispatcher(): Dispatcher {
  const tables = new Map<string, Map<string, Row>>();

  function getTable(entity: string): Map<string, Row> {
    let table = tables.get(entity);
    if (!table) {
      table = new Map();
      tables.set(entity, table);
    }
    return table;
  }

  async function write<TData = unknown>(
    type: string,
    payload: unknown,
    _opts?: WriteOpts,
  ): Promise<WriteResult<TData>> {
    const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary mock-dispatcher wire payload

    if (type === FORM_DRAFT_SAVE) {
      const draftKey = data["draftKey"] as string;
      const blob: FormDraftBlob = {
        values: (data["values"] ?? {}) as Record<string, unknown>,
        stepIndex: (data["stepIndex"] as number | undefined) ?? 0,
        savedAt: Temporal.Now.instant().toString(),
      };
      localStorage.setItem(draftStorageKey(draftKey), JSON.stringify(blob));
      return { isSuccess: true, data: {} as unknown as TData };
    }
    if (type === FORM_DRAFT_DISCARD) {
      const draftKey = data["draftKey"] as string;
      localStorage.removeItem(draftStorageKey(draftKey));
      return { isSuccess: true, data: {} as unknown as TData };
    }

    const parts = type.split(":");
    if (parts.length < 4) {
      throw new Error(
        `mock-dispatcher: invalid write qn "${type}" — expected <feature>:write:<entity>:<verb>`,
      );
    }
    const [, , entity, verb] = parts as [string, string, string, string];
    if (verb !== "create") {
      throw new Error(`mock-dispatcher: unsupported write verb "${verb}" (qn=${type})`);
    }
    const table = getTable(entity);
    const id = (data["id"] as string | undefined) ?? generateId();
    const row: Row = { ...data, id };
    table.set(id, row);
    // Mirrored to localStorage so e2e specs can assert the create payload
    // from Playwright's page.evaluate() without reaching into this closure.
    const created = JSON.parse(localStorage.getItem(CREATED_LISTINGS_KEY) ?? "[]") as Row[];
    created.push(row);
    localStorage.setItem(CREATED_LISTINGS_KEY, JSON.stringify(created));
    return { isSuccess: true, data: row as unknown as TData };
  }

  async function query<TData = unknown>(
    type: string,
    payload: unknown,
    _opts?: QueryOpts,
  ): Promise<QueryResult<TData>> {
    if (type === FORM_DRAFT_GET) {
      const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary mock-dispatcher wire payload
      const draftKey = data["draftKey"] as string;
      const raw = localStorage.getItem(draftStorageKey(draftKey));
      const draft = raw === null ? null : (JSON.parse(raw) as FormDraftBlob);
      return { isSuccess: true, data: { draft } as unknown as TData };
    }
    if (type === FORM_DRAFT_LIST) {
      // Mirrors the real handler's LIKE-prefix scan (issue #1913's
      // RenderEdit mount-time fallback needs this for create-mode wizards
      // whose sessionStorage-held draftId was lost — new tab, cleared
      // storage) — same source of truth as FORM_DRAFT_SAVE/GET above.
      const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary mock-dispatcher wire payload
      const screenId = data["screenId"] as string;
      const prefix = draftStorageKey(`${screenId}:`);
      const drafts: Array<{
        readonly id: string;
        readonly draftKey: string;
        readonly stepIndex: number;
        readonly savedAt: string;
      }> = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith(prefix)) continue;
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        const blob = JSON.parse(raw) as FormDraftBlob;
        const draftKey = key.slice(DRAFT_STORAGE_PREFIX.length);
        drafts.push({ id: draftKey, draftKey, stepIndex: blob.stepIndex, savedAt: blob.savedAt });
      }
      return { isSuccess: true, data: { drafts } as unknown as TData };
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
