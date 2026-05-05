// @vitest-environment jsdom
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
    done: { type: "boolean" },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [{ title: "Basics", fields: ["title", "count", "done"] }],
  },
};

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "count", "done"],
};

const schema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [editScreen, listScreen],
};

function makeDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher {
  const base = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
  return { ...base, ...overrides };
}

describe("KumikoScreen", () => {
  test("unknown qn → not-found placeholder", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:ghost" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-not-found")).toBeTruthy();
  });

  test("entityEdit → renders RenderEdit form for the screen's entity", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("field-done")).toBeTruthy();
  });

  test("entityList → fires useQuery with derived query QN and renders RenderList", async () => {
    const seenTypes: string[] = [];
    const query = vi.fn(async (type: string) => {
      seenTypes.push(type);
      return {
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "hello", count: 3, done: false }],
          nextCursor: null,
        },
      } as never;
    });
    const dispatcher = makeDispatcher({
      query: query as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-list-table")).toBeTruthy();
    expect(screen.getByTestId("cell-r1-title").textContent).toBe("hello");
    // Derived query QN matches the server-side qualification rule.
    expect(seenTypes).toEqual(["tasks:query:task:list"]);
  });

  test("entityEdit with unknown entity on the screen → entity-missing placeholder", () => {
    const brokenScreen: EntityEditScreenDefinition = {
      id: "broken",
      type: "entityEdit",
      entity: "ghost-entity",
      layout: { sections: [{ title: "x", fields: [] }] },
    };
    const brokenSchema: FeatureSchema = {
      ...schema,
      screens: [brokenScreen],
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={brokenSchema} qn="tasks:screen:broken" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-entity-missing")).toBeTruthy();
  });

  test("entityEdit mit entityId → lädt detail, pre-fillt Form, submit update mit {id,version,changes}", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 7, title: "loaded-title", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "task-1" } };
      }) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    // Zuerst Loading, dann Form mit den geladenen Werten.
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("loaded-title");

    // Edit + submit → write command trägt { id, version, changes: {title} }
    fireEvent.change(titleInput, { target: { value: "edited-title" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const [call] = writeCalls;
    expect(call?.type).toBe("tasks:write:task:update");
    expect(call?.payload).toEqual({
      id: "task-1",
      version: 7,
      changes: { title: "edited-title" },
    });
  });

  test("entityList onRowClick → Callback feuert mit Row-Viewmodel", async () => {
    const clicks: { id: string }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "row-1", title: "hello", count: 3, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schema}
          qn="tasks:screen:task-list"
          onRowClick={(row) => clicks.push({ id: row.id })}
        />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    fireEvent.click(screen.getByTestId("row-row-1"));
    expect(clicks).toEqual([{ id: "row-1" }]);
  });

  test("entityEdit update-mode: Delete-Button öffnet Confirm-Dialog + write('delete')", async () => {
    const user = userEvent.setup();
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 7, title: "loaded", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    // userEvent statt fireEvent: Radix Dialog feuert async State-Updates
    // (Presence/FocusScope/DismissableLayer) — fireEvent würde sie un-
    // gewickelt lassen und mit ~26 act()-Warnings spammen.
    await user.click(screen.getByTestId("render-edit-delete"));
    expect(screen.getByTestId("render-edit-delete-dialog")).toBeTruthy();
    expect(writeCalls.length).toBe(0);

    await user.click(screen.getByTestId("render-edit-delete-dialog-confirm"));
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]).toEqual({
      type: "tasks:write:task:delete",
      payload: { id: "task-1" },
    });
  });

  test("entityEdit create-mode: kein Delete-Button (keine entity-id → nichts zu löschen)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
  });

  test("entityEdit update-mode: version_conflict → Banner + 'Neu laden' triggert detail-refetch", async () => {
    let detailCalls = 0;
    const dispatcher = makeDispatcher({
      query: (async () => {
        detailCalls += 1;
        return {
          isSuccess: true,
          data: {
            id: "task-1",
            version: detailCalls,
            title: `v${detailCalls}`,
            count: 0,
            done: false,
          },
        };
      }) as unknown as Dispatcher["query"],
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "version_conflict",
          httpStatus: 409,
          i18nKey: "errors.versionConflict",
          message: "stale",
        },
      })) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;

    // Dirty machen damit der Submit überhaupt feuert.
    fireEvent.change(titleInput, { target: { value: "edited" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    // Banner muss den i18nKey zeigen und einen Reload-Button anbieten.
    await waitFor(() => expect(screen.queryByTestId("render-edit-form-error")).toBeTruthy());
    expect(screen.getByTestId("render-edit-form-error-key").textContent).toBe(
      "errors.versionConflict",
    );

    expect(detailCalls).toBe(1);
    fireEvent.click(screen.getByTestId("render-edit-form-error-reload"));
    await waitFor(() => expect(detailCalls).toBe(2));
    // Banner verschwindet nach dem Reload.
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  // RowActions-Mapping (Tier 2.7a Resolution-Layer): pinst dass
  // EntityListBody die Schema-Form (handler-QN, label-i18nKey, payload-
  // builder, visible-Function, confirmLabel) zu DataTableRowAction
  // (translated, dispatcher-resolved) korrekt transformiert. Vorher
  // nur indirekt über DataTable-Tests + manuelle Inspection abgedeckt.
  test("entityList rowActions: Schema → translate + dispatch wiring", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });

    const screenWithActions: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          id: "archive",
          label: "actions.archive",
          handler: "tasks:write:task:archive",
          payload: (row) => ({ id: row["id"], reason: "manual" }),
        },
      ],
    };
    const schemaWithActions: FeatureSchema = {
      ...schema,
      screens: [screenWithActions],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schemaWithActions} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    // Inline-Button mit der ID aus dem Schema. Label kommt durch
    // translate() — fallback ist der Key wenn kein Bundle (test-utils
    // mountet eins mit identity-translator).
    const button = screen.getByTestId("row-r1-action-archive");
    expect(button).toBeTruthy();

    // Click → dispatcher.write mit handler-QN + custom payload (NICHT
    // default `{id}`, sondern der schema-payload-builder muss greifen).
    fireEvent.click(button);
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]).toEqual({
      type: "tasks:write:task:archive",
      payload: { id: "r1", reason: "manual" },
    });
  });

  // Tier 2.7e-1: rowAction kind="navigate" — Click ruft nav.navigate
  // mit screen-id, ggf. mit URL-Search-Params aus params(row).
  test("entityList rowActions kind=navigate: Click → nav.navigate + setSearchParams", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const searchParamUpdates: Record<string, string | null>[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: (u: Record<string, string | null>) => searchParamUpdates.push(u),
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          kind: "navigate",
          id: "edit",
          label: "actions.edit",
          screen: "task-edit",
          params: (row) => ({ taskId: row["id"], priority: 5 }),
        },
      ],
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithNav] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("row-r1-action-edit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
    // params werden zu Strings serialisiert (URL-Layer kennt nur Strings).
    expect(searchParamUpdates).toEqual([{ taskId: "r1", priority: "5" }]);
  });

  test("entityList rowActions kind=navigate ohne params: setSearchParams wird NICHT gerufen", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const searchParamUpdates: Record<string, string | null>[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: (u: Record<string, string | null>) => searchParamUpdates.push(u),
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [{ kind: "navigate", id: "view", label: "actions.view", screen: "task-edit" }],
    };
    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithNav] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("row-r1-action-view"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(searchParamUpdates).toEqual([]);
  });

  // toolbarActions: Schema-Form (kind: navigate | writeHandler) →
  // Resolved-Form (onTrigger callback). Pinst beide kinds:
  //  - navigate dispatch ein nav.navigate({ screenId })
  //  - writeHandler dispatched dispatcher.write(handler, payload?())
  test("entityList toolbarActions navigate-kind: Click → nav.navigate", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const screenWithToolbar: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        { kind: "navigate", id: "open", label: "actions.open", screen: "task-edit" },
      ],
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithToolbar] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("render-list-toolbar-action-open"));
    expect(navigateCalls).toEqual([{ screenId: "task-edit" }]);
  });

  test("entityList toolbarActions writeHandler-kind: Click → dispatcher.write", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    const screenWithToolbar: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        {
          kind: "writeHandler",
          id: "sync",
          label: "actions.sync",
          handler: "tasks:write:task:sync",
          payload: () => ({ all: true }),
        },
      ],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [screenWithToolbar] }}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("render-list-toolbar-action-sync"));
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]).toEqual({ type: "tasks:write:task:sync", payload: { all: true } });
  });

  // Tier 2.7c: Screen-Level filter wird vom Schema in den Query-
  // Payload propagiert. Drei Buckets ("scheduled" / "active" / "done")
  // teilen sich denselben Query-Handler — der Filter unterscheidet
  // welche Rows kommen.
  test("entityList screen-filter: schema.filter landet im query-payload", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return {
          isSuccess: true,
          data: { rows: [], nextCursor: null },
        };
      }) as unknown as Dispatcher["query"],
    });

    const filteredScreen: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      filter: { field: "status", op: "eq", value: "scheduled" },
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [filteredScreen] }}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));

    const firstCall = queryCalls[0];
    expect(firstCall?.type).toBe("tasks:query:task:list");
    const payload = firstCall?.payload as { filter?: unknown };
    expect(payload.filter).toEqual({ field: "status", op: "eq", value: "scheduled" });
  });

  // Regression-Guard: Default-Pfad (kein screen.filter) darf KEIN
  // filter-Feld in den queryPayload schicken. Sonst würde Zod-Strict
  // ein leeres `filter: undefined` als 400 abweisen, oder ein
  // "match-none"-Default-Drift entstehen.
  test("entityList ohne screen.filter: queryPayload hat kein filter-Feld", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return {
          isSuccess: true,
          data: { rows: [], nextCursor: null },
        };
      }) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));

    const payload = queryCalls[0]?.payload as { filter?: unknown };
    expect("filter" in payload).toBe(false);
  });

  test("entityList rowActions visible-filter: hidden Action erscheint nicht im DOM", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [
            { id: "r1", title: "Open", status: "scheduled", count: 0, done: false },
            { id: "r2", title: "Done", status: "completed", count: 0, done: true },
          ],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithVisible: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          id: "start",
          label: "actions.start",
          handler: "tasks:write:task:start",
          // Nur sichtbar bei status===scheduled
          visible: (row: unknown) => (row as { status?: string }).status === "scheduled",
        },
      ],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [screenWithVisible] }}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    expect(screen.queryByTestId("row-r1-action-start")).not.toBeNull();
    expect(screen.queryByTestId("row-r2-action-start")).toBeNull();
  });

  // --- actionForm (Tier 2.7d) ---
  // Non-CRUD Write-Handler-driven Form. Schema deklariert handler-QN +
  // inline fields; Renderer baut darauf den selben RenderEdit-Stack
  // wie entityEdit, aber Submit ruft den deklarierten handler statt
  // <feature>:write:<entity>:create.
  test("actionForm: rendert Form-Felder + Submit triggert dispatcher.write(handler, values)", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "new-id" } };
      }) as unknown as Dispatcher["write"],
    });

    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: {
        title: { type: "text", required: true },
        priority: { type: "number", default: 1 },
      },
      layout: { sections: [{ title: "Basics", fields: ["title", "priority"] }] },
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:quick-add" />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    fireEvent.change(titleInput, { target: { value: "New Task" } });

    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]?.type).toBe("tasks:write:task:quick-add");
    // payloadMode="values" — alle Form-Werte landen im Payload, nicht
    // nur die geänderten. Defaults (priority=1) bleiben drin.
    expect(writeCalls[0]?.payload).toEqual({ title: "New Task", priority: 1 });
  });

  test("actionForm mit redirect: nach success → nav.navigate({screenId: redirect})", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "x" },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "task-list",
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen, listScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "go" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-list" });
  });

  // Tier 2.7e-2: URL-Search-Params füllen die actionForm initial values.
  // Use-case: rowAction kind=navigate setzt `?taskId=r1`, das actionForm
  // sieht es beim Mount und pre-fillt das title-Feld.
  test("actionForm initial values: searchParams überschreiben Field-Defaults", async () => {
    const memoryNav = {
      route: { screenId: "approve" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: () => "/x",
      searchParams: { title: "Pre-filled", priority: "9", isDone: "true" },
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher();
    const actionScreen: ActionFormScreenDefinition = {
      id: "approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: {
        title: { type: "text", default: "default-title" },
        priority: { type: "number", default: 1 },
        isDone: { type: "boolean", default: false },
      },
      layout: {
        sections: [{ title: "x", fields: ["title", "priority", "isDone"] }],
      },
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("Pre-filled");
    // Number-coercion: "9" → 9. Erfolgreiche Coercion bedeutet das
    // Number-Input zeigt "9" (nicht den default 1).
    const priorityInput = screen
      .getByTestId("field-priority")
      .querySelector("input") as HTMLInputElement;
    expect(priorityInput.value).toBe("9");
  });

  test("actionForm initial values: searchParam mit fehlerhafter Number → Default-Fallback", async () => {
    const memoryNav = {
      route: { screenId: "approve" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: () => "/x",
      searchParams: { priority: "not-a-number" },
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher();
    const actionScreen: ActionFormScreenDefinition = {
      id: "approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: { priority: { type: "number", default: 7 } },
      layout: { sections: [{ title: "x", fields: ["priority"] }] },
    };
    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
        </DispatcherProvider>
      </NavProvider>,
    );
    const priorityInput = screen
      .getByTestId("field-priority")
      .querySelector("input") as HTMLInputElement;
    expect(priorityInput.value).toBe("7"); // Fallback auf default
  });

  test("actionForm submitLabel: i18n-Key landet auf dem Submit-Button (übersteuert default)", () => {
    const dispatcher = makeDispatcher();
    const actionScreen: ActionFormScreenDefinition = {
      id: "approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: { note: { type: "text" } },
      layout: { sections: [{ title: "x", fields: ["note"] }] },
      submitLabel: "actions.approve",
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
      </DispatcherProvider>,
    );

    // Test-utils mountet einen identity-translator als Fallback —
    // unbekannte Keys returnen den Key selbst, also rendert "actions.approve".
    expect(screen.getByTestId("render-edit-submit").textContent).toBe("actions.approve");
  });

  test("actionForm ohne redirect: nach success bleibt der User auf der Form (kein navigate)", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "x" } };
      }) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      // redirect bewusst NICHT gesetzt
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "stay" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    // Auf den Write-Call warten — sonst racet der Test gegen den
    // async submit und prüft navigate-Calls bevor handleSubmitted
    // überhaupt gerufen wurde (waitFor auf "render-edit-form" wäre
    // ein no-op weil die Form sowieso schon mounted ist).
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(navigateCalls).toEqual([]);
  });

  test("custom screen type → placeholder (M4 wires r.uiComponent)", () => {
    const customSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: taskEntity },
      screens: [
        {
          id: "dashboard",
          type: "custom",
          renderer: { react: "Dashboard" },
        },
      ],
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={customSchema} qn="tasks:screen:dashboard" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-custom-placeholder")).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Auto-Navigate Targets — die drei Hooks im kumiko-screen-Renderer
  // (useNavigateToCreateFor, useNavigateToListAfter, default
  // onRowClick in create-app) ziehen `screenId` aus `schema.screens[].id`
  // und reichen sie an `nav.navigate({ screenId })` durch. Heute hält
  // die Registry SHORT-form-ids in `feature.screens` (siehe
  // packages/framework/src/engine/registry.ts: feature.screens[shortId]
  // = def). Falls dieser Vertrag jemals kippt (Registry stempelt QN-
  // form ein), strippt `lastSegment` defensiv den Prefix — die Tests
  // pinnen beide Pfade.
  // ------------------------------------------------------------------

  test("entityList + Neu-Button → navigiert mit screenId aus Schema", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("render-list-create"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // Short-Form-id, nicht QN — sonst würde der Browser auf
    // "/tasks:screen:task-edit" landen und der Re-Lookup würde
    // doppelt-qualifizieren.
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });

  test("Auto-Navigate ist defensiv: schema.screens.id mit Doppel-Punkt-Prefix wird gestrippt", async () => {
    // Defense-in-Depth: falls die Registry irgendwann QN-form-ids in
    // schema.screens stamped, würde useNavigateToCreateFor ohne
    // lastSegment einen QN als screenId weiterreichen → URL doppelt-
    // qualifiziert. Test simuliert diesen hypothetischen Fall.
    const navigateCalls: { screenId: string }[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: { screenId: string }) => navigateCalls.push(target),
      replace: () => undefined,
      hrefFor: (t: { screenId: string }) => `/${t.screenId}`,
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });

    // Hypothetische QN-form Edit-id; List bleibt short, sonst findet
    // KumikoScreen seine eigene List-Sicht nicht (qualifyScreenId
    // arbeitet immer feature-prefix-style).
    const editScreenQn: EntityEditScreenDefinition = {
      ...editScreen,
      id: "tasks:screen:task-edit",
    };
    const mixedSchema: FeatureSchema = {
      ...schema,
      screens: [editScreenQn, listScreen],
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={mixedSchema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("render-list-create"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // lastSegment hat den QN-Prefix gestrippt — ohne den Fix würde
    // hier "tasks:screen:task-edit" stehen.
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });
});
