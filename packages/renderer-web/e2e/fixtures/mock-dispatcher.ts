// In-memory Dispatcher für renderer-web/e2e. Implementiert das
// Dispatcher-Interface aus @kumiko/headless ohne HTTP-Layer — der
// Mock lebt im Browser-Bundle, jeder Playwright-Page-Boot bekommt
// einen fresh Mock mit fresh State.
//
// Wire-Format: createKumikoApp ruft dispatcher.write/query mit
// QN-strings ("<feature>:write:<entity>:<verb>"). Der Mock parst die
// QN, leitet `verb` aus dem letzten Segment ab und arbeitet auf einer
// per-entity-Map. Reicht für CRUD-Smoke-Tests.
//
// Bewusst simpel: kein optimistic-locking, kein soft-delete, keine
// validation — diese Pfade werden gegen den echten Stack in apps/
// ui-walkthrough getestet. Hier nur "renderer ruft dispatcher mit
// erwarteten QNs an, dispatcher antwortet im erwarteten Format".

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
} from "@kumiko/headless";

type Row = Record<string, unknown> & { id: string };

export type MockDispatcherState = {
  /** Pre-seed Daten — z.B. um List-Renderings zu testen ohne erst create
   *  zu rufen. Keys sind entity-Names (so wie sie in der QN auftauchen). */
  readonly seed?: Readonly<Record<string, readonly Row[]>>;
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

// Read-only Store-Stub für statusStore. Tests interessieren sich nicht
// für Online/Offline-Transitions — der Status ist immer "online".
const ONLINE_STORE: Store<DispatcherStatus> = {
  getSnapshot: () => "online",
  subscribe: () => () => {},
};

export function createMockDispatcher(state: MockDispatcherState = {}): Dispatcher {
  const tables = new Map<string, Map<string, Row>>();

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
    const data = (payload ?? {}) as Record<string, unknown>;

    switch (verb) {
      case "create": {
        const id = (data["id"] as string | undefined) ?? generateId();
        const row: Row = { ...data, id };
        table.set(id, row);
        return { isSuccess: true, data: row as unknown as TData };
      }
      case "update": {
        const id = data["id"] as string | undefined;
        if (id === undefined) throw new Error(`MockDispatcher: update without id (qn=${type})`);
        const existing = table.get(id);
        if (!existing)
          throw new Error(`MockDispatcher: update on missing row id=${id} entity=${entity}`);
        const row: Row = { ...existing, ...data, id };
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
    const { entity, verb } = parseQn(type);
    const table = getTable(entity);

    switch (verb) {
      case "list": {
        const rows = Array.from(table.values());
        // Wire-Format des Listen-Queries: { rows, nextCursor }. Das
        // KumikoScreen → EntityListBody zieht `data.rows` raus
        // (siehe kumiko-screen.tsx:PagedRows). nextCursor ist immer
        // null im Mock — wir machen keine Pagination.
        return {
          isSuccess: true,
          data: { rows, nextCursor: null } as unknown as TData,
        };
      }
      case "detail": {
        const data = (payload ?? {}) as Record<string, unknown>;
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
    write,
    query,
    batch,
    statusStore: ONLINE_STORE,
    pendingWrites: (): readonly PendingWrite[] => [],
    pendingFiles: (): readonly PendingFile[] => [],
  };
}
