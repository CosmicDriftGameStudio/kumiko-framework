// @vitest-environment jsdom
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";
import type { Dispatcher, StatusChangeListener } from "@kumiko/headless";
import type { FeatureSchema } from "@kumiko/renderer";
import { DispatcherProvider, KumikoScreen } from "@kumiko/renderer";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";

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
  const listeners = new Set<StatusChangeListener>();
  const base: Dispatcher = {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
    batch: async () => ({ isSuccess: true, results: [] }) as never,
    status: () => "online",
    onStatusChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
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

  test("entityEdit update-mode: Delete-Button zwei-click-confirm + write('delete')", async () => {
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

    // Erster Klick: zeigt Confirm-State, kein write noch.
    fireEvent.click(screen.getByTestId("render-edit-delete"));
    expect(screen.getByTestId("render-edit-delete-confirm")).toBeTruthy();
    expect(writeCalls.length).toBe(0);

    // Zweiter Klick: delete-command feuert.
    fireEvent.click(screen.getByTestId("render-edit-delete-confirm"));
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
