// @vitest-environment jsdom
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";
import type { Dispatcher } from "@kumiko/headless";
import type { FeatureSchema } from "@kumiko/renderer";
import { DispatcherProvider, KumikoScreen } from "@kumiko/renderer";
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

    const { NavProvider } = await import("@kumiko/renderer");
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
          visible: (row: unknown) => (row as Record<string, unknown>)["status"] === "scheduled",
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
});
