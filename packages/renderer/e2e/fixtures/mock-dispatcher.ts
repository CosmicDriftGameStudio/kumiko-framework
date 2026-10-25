// In-memory dispatcher for renderer/e2e. Implements the
// dispatcher interface from @cosmicdrift/kumiko-renderer/headless without an HTTP layer — the
// mock lives in the browser bundle, every Playwright page boot gets
// a fresh mock with fresh state.
//
// Wire format: createKumikoApp calls dispatcher.write/query with
// QN strings ("<feature>:write:<entity>:<verb>"). The mock parses the
// QN, derives `verb` from the last segment and works on a
// per-entity map. Sufficient for CRUD smoke tests.
//
// Deliberately simple: no optimistic locking, no soft delete, no
// validation — those paths are tested against the real stack in apps/
// ui-walkthrough. Here only "renderer calls the dispatcher with
// the expected QNs, the dispatcher answers in the expected format".

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
} from "@cosmicdrift/kumiko-renderer/headless";

import { dashboardQueryResponse } from "./dashboard-fixture";
import { answerMockList } from "./mock-list-query";
import { ROLE_AVAILABILITY_QUERY } from "./schema";

export const FAILING_WRITE_REQUEST_ID = "req-7f9c2a1e-4b3d-4c8a-9e21-5d6f0a1b2c3d";

type Row = Record<string, unknown> & { id: string };

export type MockDispatcherState = {
  /** Pre-seed data — e.g. to test list renderings without calling create
   *  first. Keys are entity names (as they appear in the QN). */
  readonly seed?: Readonly<Record<string, readonly Row[]>>;
  /** Row ids whose writes answer with an access error, like a row the user may not change. */
  readonly rejectWriteIds?: readonly string[];
  /** Writes wait for `releaseWrites()` before they answer, so in-flight writes stay observable. */
  readonly holdWrites?: boolean;
};

export type MockDispatcher = Dispatcher & {
  /** `<verb>:<id>` of every write in the order it started. */
  readonly writeLog: readonly string[];
  readonly releaseWrites: () => void;
};

let nextId = 1;

function generateId(): string {
  return `mock-${nextId++}`;
}

function parseQn(qn: string): {
  feature: string;
  kind: "write" | "query";
  entity: string;
  verb: string;
} {
  const parts = qn.split(":");
  if (parts.length < 4) {
    throw new Error(
      `MockDispatcher: invalid qn "${qn}" — expected <feature>:<kind>:<entity>:<verb>`,
    );
  }
  const [feature, kind, entity, verb] = parts;
  if (kind !== "write" && kind !== "query") {
    throw new Error(`MockDispatcher: invalid kind "${kind}" in qn "${qn}"`);
  }
  return {
    feature: feature as string,
    kind,
    entity: entity as string,
    verb: verb as string,
  };
}

// Read-only store stub for statusStore. Tests do not care about
// online/offline transitions — the status is always "online".
const ONLINE_STORE: Store<DispatcherStatus> = {
  getSnapshot: () => "online",
  subscribe: () => () => {},
};

export function createMockDispatcher(state: MockDispatcherState = {}): MockDispatcher {
  const tables = new Map<string, Map<string, Row>>();
  const writeLog: string[] = [];
  const rejectWriteIds = new Set(state.rejectWriteIds ?? []);
  let writesHeld = state.holdWrites === true;
  const heldWrites: (() => void)[] = [];

  function releaseWrites(): void {
    writesHeld = false;
    for (const resume of heldWrites.splice(0)) resume();
  }

  // Seed laden
  for (const [entity, rows] of Object.entries(state.seed ?? {})) {
    const map = new Map<string, Row>();
    for (const row of rows) map.set(row.id, row);
    tables.set(entity, map);
  }

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
    const { entity, verb } = parseQn(type);
    const table = getTable(entity);
    const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary render-helper
    const rowId = data["id"];
    writeLog.push(`${verb}:${String(rowId)}`);
    if (writesHeld) await new Promise<void>((resume) => heldWrites.push(resume));
    if (typeof rowId === "string" && rejectWriteIds.has(rowId)) {
      return {
        isSuccess: false,
        error: {
          code: "access_denied",
          httpStatus: 403,
          i18nKey: "errors.access_denied",
          message: `No access to ${rowId}.`,
        },
      };
    }

    switch (verb) {
      case "fail":
        return {
          isSuccess: false,
          error: {
            code: "internal_error",
            httpStatus: 500,
            i18nKey: "errors.internal",
            message: "The server could not complete the action.",
            requestId: FAILING_WRITE_REQUEST_ID,
          },
        };
      case "create": {
        const id = (data["id"] as string | undefined) ?? generateId();
        const row: Row = { ...data, id };
        table.set(id, row);
        return { isSuccess: true, data: row as unknown as TData };
      }
      case "archive":
      case "update": {
        const id = data["id"] as string | undefined;
        if (id === undefined) throw new Error(`MockDispatcher: update without id (qn=${type})`);
        const existing = table.get(id);
        if (!existing)
          throw new Error(`MockDispatcher: update on missing row id=${id} entity=${entity}`);
        const row: Row = {
          ...existing,
          ...data,
          ...(verb === "archive" && { archived: true }),
          id,
        };
        table.set(id, row);
        return { isSuccess: true, data: row as unknown as TData };
      }
      case "delete": {
        const id = data["id"] as string | undefined;
        if (id === undefined) throw new Error(`MockDispatcher: delete without id (qn=${type})`);
        table.delete(id);
        return { isSuccess: true, data: { id } as unknown as TData };
      }
      default:
        throw new Error(`MockDispatcher: unsupported write verb "${verb}" (qn=${type})`);
    }
  }

  async function query<TData = unknown>(
    type: string,
    payload: unknown,
    _opts?: QueryOpts,
  ): Promise<QueryResult<TData>> {
    if (type === ROLE_AVAILABILITY_QUERY) {
      const rows = [
        ...["User", "Member", "Editor", "Admin"].map((value) => ({ value, disabled: false })),
        { value: "TenantAdmin", disabled: true },
      ];
      return { isSuccess: true, data: { rows } as unknown as TData };
    }
    const dashboardResponse = dashboardQueryResponse(type);
    if (dashboardResponse !== undefined) {
      return { isSuccess: true, data: dashboardResponse as unknown as TData };
    }
    const { entity, verb } = parseQn(type);
    const table = getTable(entity);

    switch (verb) {
      case "list":
        return {
          isSuccess: true,
          data: answerMockList(type, Array.from(table.values()), payload) as unknown as TData,
        };
      case "detail": {
        const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary render-helper
        const id = data["id"] as string | undefined;
        if (id === undefined) throw new Error(`MockDispatcher: detail without id (qn=${type})`);
        const row = table.get(id);
        if (!row)
          throw new Error(`MockDispatcher: detail on missing row id=${id} entity=${entity}`);
        return { isSuccess: true, data: row as unknown as TData };
      }
      default:
        throw new Error(`MockDispatcher: unsupported query verb "${verb}" (qn=${type})`);
    }
  }

  async function batch(commands: readonly Command[], opts?: WriteOpts): Promise<BatchResult> {
    const results: WriteResult[] = [];
    for (const cmd of commands) {
      results.push(await write(cmd.type, cmd.payload, opts));
    }
    return { isSuccess: true, results };
  }

  return {
    writeLog,
    releaseWrites,
    write,
    query,
    batch,
    statusStore: ONLINE_STORE,
    async *stream() {},
    pendingWrites: (): readonly PendingWrite[] => [],
    pendingFiles: (): readonly PendingFile[] => [],
  };
}
