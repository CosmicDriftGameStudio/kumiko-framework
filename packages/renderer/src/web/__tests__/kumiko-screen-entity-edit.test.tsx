import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { clickSubmitOnceEnabled, listScreen } from "./_kumiko-screen-helpers.tsx";
import {
  fireEvent,
  makeDispatcher,
  render,
  screen,
  taskEntity,
  waitFor,
  within,
} from "./test-utils.tsx";

// --- update-only entityEdit (allowCreate / allowDelete, wave J) ---
// Lifecycle entities (incident: create via incident:open, no CRUD delete)
// need an edit screen WITHOUT the CRUD assumptions; otherwise the list
// renders a "+ New" button into a create branch whose submit would hit an
// unregistered <entity>:create handler, and the update form a delete button
// against a missing delete handler.
describe("KumikoScreen: update-only entityEdit (allowCreate/allowDelete)", () => {
  const updateOnlyEdit: EntityEditScreenDefinition = {
    id: "task-edit",
    type: "entityEdit",
    entity: "task",
    allowCreate: false,
    allowDelete: false,
    layout: { sections: [{ title: "Basics", fields: ["title"] }] },
  };
  const updateOnlySchema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [updateOnlyEdit, listScreen],
  };

  test("allowDelete:false → update-mode rendert keinen Delete-Button", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 3, title: "loaded", count: 0, done: false },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={updateOnlySchema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
  });

  test("allowCreate:false → entityList rendert keinen automatischen + Neu-Button", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={updateOnlySchema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.queryByTestId("render-list-create")).toBeNull();
  });

  test("entityList allowCreate:false hides + Neu while the edit screen keeps its create branch", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const renderList = async (list: typeof listScreen) => {
      const view = render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{
              featureName: "tasks",
              entities: { task: taskEntity },
              screens: [{ ...updateOnlyEdit, allowCreate: undefined }, list],
            }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      return view;
    };
    const hidden = await renderList({ ...listScreen, allowCreate: false });
    expect(screen.queryByTestId("render-list-create")).toBeNull();
    hidden.unmount();
    await renderList(listScreen);
    expect(screen.getByTestId("render-list-create")).toBeTruthy();
  });

  test("allowCreate:false → Aufruf ohne entityId zeigt Fehler-Banner statt Create-Form", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={updateOnlySchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-create-disabled")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });
});

// --- entityEdit header actions (fw entityEdit-actions) ---
// EntityEditScreenDefinition.actions mirrors ProjectionDetailScreenDefinition.
// actions — same RenderEdit `actions` prop, same icon-only collapse rule
// (shouldRenderActionsIconOnly: >2 actions, every one resolves an icon).
describe("KumikoScreen: entityEdit header actions", () => {
  const threeActionsScreen: EntityEditScreenDefinition = {
    id: "task-edit-actions-3",
    type: "entityEdit",
    entity: "task",
    layout: { sections: [{ title: "Basics", fields: ["title"] }] },
    // ids match ACTION_ICON_BY_ID entries (publish/archive/duplicate) so
    // every action resolves an icon without an explicit `icon` field.
    actions: [
      { id: "publish", label: "Publish", handler: "tasks:write:task:publish" },
      { id: "archive", label: "Archive", handler: "tasks:write:task:archive" },
      { id: "duplicate", label: "Duplicate", handler: "tasks:write:task:duplicate" },
    ],
  };
  const twoActionsScreen: EntityEditScreenDefinition = {
    ...threeActionsScreen,
    id: "task-edit-actions-2",
    actions: threeActionsScreen.actions?.slice(0, 2),
  };
  const actionsSchema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [threeActionsScreen, twoActionsScreen],
  };
  const detailDispatcher = () =>
    makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 1, title: "loaded", count: 0, done: false },
      })) as unknown as Dispatcher["query"],
    });

  test("update-mode mit drei Header-Actions kollabiert auf Icon-only mit ariaLabel", async () => {
    render(
      <DispatcherProvider dispatcher={detailDispatcher()}>
        <KumikoScreen
          schema={actionsSchema}
          qn="tasks:screen:task-edit-actions-3"
          entityId="task-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const cases = [
      ["publish", "Publish"],
      ["archive", "Archive"],
      ["duplicate", "Duplicate"],
    ] as const;
    for (const [id, label] of cases) {
      const button = screen.getByTestId(`render-edit-action-${id}`);
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-label")).toBe(label);
    }
  });

  test("update-mode mit zwei Header-Actions zeigt weiterhin sichtbaren Text", async () => {
    render(
      <DispatcherProvider dispatcher={detailDispatcher()}>
        <KumikoScreen
          schema={actionsSchema}
          qn="tasks:screen:task-edit-actions-2"
          entityId="task-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    expect(screen.getByTestId("render-edit-action-publish").textContent).toBe("Publish");
    expect(screen.getByTestId("render-edit-action-archive").textContent).toBe("Archive");
  });

  test("update-mode mit drei Header-Actions kollabiert auch den Copy-Link-Button auf Icon-only mit ariaLabel", async () => {
    render(
      <DispatcherProvider dispatcher={detailDispatcher()}>
        <KumikoScreen
          schema={actionsSchema}
          qn="tasks:screen:task-edit-actions-3"
          entityId="task-1"
          onCopyLink={() => Promise.resolve()}
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const button = screen.getByTestId("render-edit-copy-link");
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Copy link");
  });

  // Design decision (fw entityEdit-actions): actions target an EXISTING
  // record (publish/archive/duplicate and friends) — create mode has none
  // yet, so EntityEditCreateBody never builds a headerActions prop at all.
  test("create-mode (kein entityId) rendert keine Header-Actions", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={actionsSchema} qn="tasks:screen:task-edit-actions-3" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-action-publish")).toBeNull();
    expect(screen.queryByTestId("render-edit-action-archive")).toBeNull();
    expect(screen.queryByTestId("render-edit-action-duplicate")).toBeNull();
  });
});

// entityEdit.actions kind:"drawer" — EntityEditUpdateForm owns its
// own DrawerHost directly (5th RowAction/action call site, not covered by
// the shared ToolbarAction plumbing's original scope). The outer update
// form and the drawer's own ActionFormBody are both `RenderEdit` instances
// mounted at once, so drawer-scoped queries use `within(...)` to avoid
// colliding with the outer form's own render-edit-form/field-* testids.
describe("KumikoScreen: entityEdit actions drawer-kind (fw#2710)", () => {
  const noteForm: ActionFormScreenDefinition = {
    id: "task-note-drawer",
    type: "actionForm",
    handler: "tasks:write:task:note",
    fields: { title: { type: "text" }, note: { type: "text", required: true } },
    layout: { sections: [{ fields: ["title", "note"] }] },
  };
  const editScreenWithDrawer: EntityEditScreenDefinition = {
    id: "task-edit-drawer",
    type: "entityEdit",
    entity: "task",
    layout: { sections: [{ title: "Basics", fields: ["title"] }] },
    actions: [
      {
        kind: "drawer",
        id: "add-note",
        label: "Add note",
        screen: "task-note-drawer",
        params: { pick: ["title"] },
      },
    ],
  };
  const drawerSchema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [editScreenWithDrawer, noteForm],
  };

  test("Click opens the Drawer prefilled from the record; submit dispatches, closes without navigating, and reloads the record", async () => {
    let queryCallCount = 0;
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => {
        queryCallCount += 1;
        return {
          isSuccess: true,
          data: { id: "task-1", version: 1, title: "loaded", count: 0, done: false },
        };
      }) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={drawerSchema} qn="tasks:screen:task-edit-drawer" entityId="task-1" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.queryByTestId("field-note")).toBeNull();

    fireEvent.click(screen.getByTestId("render-edit-action-add-note"));
    const drawer = () => within(screen.getByTestId("toolbar-drawer-add-note"));
    await waitFor(() => expect(drawer().getByTestId("field-note")).toBeTruthy());
    const titleInput = drawer().getByTestId("field-title").querySelector("input");
    if (titleInput === null) throw new Error("expected an <input> inside field-title");
    expect(titleInput.value).toBe("loaded");
    const queryCallsBeforeSubmit = queryCallCount;

    const noteInput = drawer().getByTestId("field-note").querySelector("input");
    if (noteInput === null) throw new Error("expected an <input> inside field-note");
    fireEvent.change(noteInput, { target: { value: "hello" } });
    await clickSubmitOnceEnabled(drawer);

    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]?.type).toBe("tasks:write:task:note");
    await waitFor(() => expect(screen.queryByTestId("field-note")).toBeNull());
    await waitFor(() => expect(queryCallCount).toBeGreaterThan(queryCallsBeforeSubmit));
  });
});
