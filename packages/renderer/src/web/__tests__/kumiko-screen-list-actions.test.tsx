import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavApi, NavTarget } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider, UserRolesProvider } from "../../index.ts";
import { clickSubmitOnceEnabled, schema } from "./_kumiko-screen-helpers.tsx";
import { fireEvent, makeDispatcher, render, screen, waitFor } from "./test-utils.tsx";

describe("KumikoScreen", () => {
  // toolbarActions kind:"drawer": mounts the referenced actionForm
  // in the Drawer primitive instead of navigating — reuses ActionFormBody
  // (no second form renderer), so submit/cancel/field-rendering all go
  // through the same RenderEdit path entityEdit/actionForm already use.
  describe("entityList toolbarActions drawer-kind", () => {
    const noteForm: ActionFormScreenDefinition = {
      id: "task-note",
      type: "actionForm",
      handler: "tasks:write:task:note",
      fields: { note: { type: "text", required: true } },
      layout: { sections: [{ fields: ["note"] }] },
    };
    const screenWithDrawer: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "task-note" },
      ],
    };

    test("Click opens the Drawer with the referenced actionForm's fields", async () => {
      const dispatcher = makeDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      });
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithDrawer, noteForm] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      expect(screen.queryByTestId("field-note")).toBeNull();

      await user.click(screen.getByTestId("render-list-toolbar-action-add-note"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      expect(screen.getByTestId("field-note")).toBeTruthy();
    });

    test("Successful submit calls the actionForm's handler, closes the Drawer, and reloads the list", async () => {
      const writeCalls: { type: string; payload: unknown }[] = [];
      let queryCallCount = 0;
      const dispatcher = makeDispatcher({
        query: (async () => {
          queryCallCount += 1;
          return { isSuccess: true, data: { rows: [], nextCursor: null } };
        }) as unknown as Dispatcher["query"],
        write: (async (type: string, payload: unknown) => {
          writeCalls.push({ type, payload });
          return { isSuccess: true, data: {} };
        }) as unknown as Dispatcher["write"],
      });
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithDrawer, noteForm] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      await user.click(screen.getByTestId("render-list-toolbar-action-add-note"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      const queryCallsBeforeSubmit = queryCallCount;

      // field-note's testId sits on the Field wrapper (label + errors +
      // control), not the <input> itself — grab the actual control to type
      // into it, same DOM-level approach as other RenderEdit field tests.
      const noteInput = screen.getByTestId("field-note").querySelector("input");
      if (noteInput === null) throw new Error("expected an <input> inside field-note");
      fireEvent.change(noteInput, { target: { value: "hello" } });
      await clickSubmitOnceEnabled();

      await waitFor(() => expect(writeCalls.length).toBe(1));
      expect(writeCalls[0]?.type).toBe("tasks:write:task:note");
      await waitFor(() => expect(screen.queryByTestId("render-edit-form")).toBeNull());
      await waitFor(() => expect(queryCallCount).toBeGreaterThan(queryCallsBeforeSubmit));
    });

    // Mirrors kind:"navigate": access is enforced when the target renders,
    // not by hiding the toolbar button — same as a role-gated navigate
    // target still shows its button but denies the destination.
    test("User without access to the target screen: button still triggers, but sees Access denied instead of the form", async () => {
      const restrictedNoteForm: ActionFormScreenDefinition = {
        ...noteForm,
        access: { roles: ["Admin"] },
      };
      const dispatcher = makeDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      });
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <UserRolesProvider roles={["Viewer"]}>
            <KumikoScreen
              schema={{ ...schema, screens: [screenWithDrawer, restrictedNoteForm] }}
              qn="tasks:screen:task-list"
            />
          </UserRolesProvider>
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

      const button = screen.getByTestId("render-list-toolbar-action-add-note");
      await user.click(button);

      expect(screen.getByTestId("kumiko-toolbar-drawer-access-denied")).toBeTruthy();
      expect(screen.queryByTestId("field-note")).toBeNull();
    });
  });

  // rowActions kind:"drawer": row-level pendant to toolbarActions
  // kind:"drawer" above — same DrawerHost/useDrawerAction
  // machinery, generalized to also serve a row-derived prefill.
  describe("entityList rowActions drawer-kind", () => {
    const noteForm: ActionFormScreenDefinition = {
      id: "task-note-drawer",
      type: "actionForm",
      handler: "tasks:write:task:note",
      fields: {
        title: { type: "text" },
        note: { type: "text", required: true },
        secret: { type: "text", sensitive: true },
      },
      layout: { sections: [{ fields: ["title", "note", "secret"] }] },
    };
    // A single rowAction keeps the DataTable's inline-button rendering
    // (>2 actions collapse to a kebab dropdown, see ListColumnSpec.rowActions
    // doc) — each test below only exercises one action at a time.
    function screenWithRowAction(
      rowAction: NonNullable<EntityListScreenDefinition["rowActions"]>[number],
    ): EntityListScreenDefinition {
      return {
        id: "task-list",
        type: "entityList",
        entity: "task",
        columns: ["title"],
        rowActions: [rowAction],
      };
    }

    function makeRowDrawerDispatcher(write?: Dispatcher["write"]): {
      dispatcher: Dispatcher;
      getQueryCallCount: () => number;
    } {
      let queryCallCount = 0;
      const dispatcher = makeDispatcher({
        query: (async () => {
          queryCallCount += 1;
          return {
            isSuccess: true,
            data: {
              rows: [{ id: "r1", title: "Alpha", count: 1, done: false, secret: "topsecret" }],
              nextCursor: null,
            },
          };
        }) as unknown as Dispatcher["query"],
        ...(write !== undefined && { write }),
      });
      return { dispatcher, getQueryCallCount: () => queryCallCount };
    }

    test("Click opens the Drawer with the row's value prefilled via `pick`", async () => {
      const rowDrawerSchema: FeatureSchema = {
        ...schema,
        screens: [
          screenWithRowAction({
            kind: "drawer",
            id: "add-note",
            label: "actions.addNote",
            screen: "task-note-drawer",
            params: { pick: ["title"] },
          }),
          noteForm,
        ],
      };
      const { dispatcher } = makeRowDrawerDispatcher();
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={rowDrawerSchema} qn="tasks:screen:task-list" />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      expect(screen.queryByTestId("field-title")).toBeNull();

      await user.click(screen.getByTestId("row-r1-action-add-note"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      const titleInput = screen.getByTestId("field-title").querySelector("input");
      if (titleInput === null) throw new Error("expected an <input> inside field-title");
      expect(titleInput.value).toBe("Alpha");
    });

    test("Click opens the Drawer with the row's value prefilled via `map`", async () => {
      const rowDrawerSchema: FeatureSchema = {
        ...schema,
        screens: [
          screenWithRowAction({
            kind: "drawer",
            id: "add-note-mapped",
            label: "actions.addNoteMapped",
            screen: "task-note-drawer",
            params: { map: { note: "title" } },
          }),
          noteForm,
        ],
      };
      const { dispatcher } = makeRowDrawerDispatcher();
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={rowDrawerSchema} qn="tasks:screen:task-list" />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

      await user.click(screen.getByTestId("row-r1-action-add-note-mapped"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      const noteInput = screen.getByTestId("field-note").querySelector("input");
      if (noteInput === null) throw new Error("expected an <input> inside field-note");
      expect(noteInput.value).toBe("Alpha");
    });

    // Locks in the mergeSearchParamsIntoInitial `sensitive` gate for the
    // drawer's direct-object overrides path — a `params` extractor naming a
    // sensitive field must not leak the row's value into the form.
    test("A sensitive field named by `params` is not prefilled", async () => {
      const rowDrawerSchema: FeatureSchema = {
        ...schema,
        screens: [
          screenWithRowAction({
            kind: "drawer",
            id: "reveal",
            label: "actions.reveal",
            screen: "task-note-drawer",
            params: { pick: ["secret"] },
          }),
          noteForm,
        ],
      };
      const { dispatcher } = makeRowDrawerDispatcher();
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={rowDrawerSchema} qn="tasks:screen:task-list" />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

      await user.click(screen.getByTestId("row-r1-action-reveal"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      const secretInput = screen.getByTestId("field-secret").querySelector("input");
      if (secretInput === null) throw new Error("expected an <input> inside field-secret");
      expect(secretInput.value).toBe("");
    });

    test("Successful submit dispatches the handler, closes the Drawer without navigating, and reloads the list", async () => {
      const rowDrawerSchema: FeatureSchema = {
        ...schema,
        screens: [
          screenWithRowAction({
            kind: "drawer",
            id: "add-note",
            label: "actions.addNote",
            screen: "task-note-drawer",
            params: { pick: ["title"] },
          }),
          noteForm,
        ],
      };
      const writeCalls: { type: string; payload: unknown }[] = [];
      const { dispatcher, getQueryCallCount } = makeRowDrawerDispatcher((async (
        type: string,
        payload: unknown,
      ) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"]);
      const navigateCalls: unknown[] = [];
      const memoryNav = {
        route: { screenId: "task-list" },
        navigate: (target: NavTarget) => {
          navigateCalls.push(target);
        },
        replace: () => undefined,
        hrefFor: () => "",
        searchParams: {},
        setSearchParams: () => undefined,
      };
      const user = userEvent.setup();
      render(
        <NavProvider value={memoryNav}>
          <DispatcherProvider dispatcher={dispatcher}>
            <KumikoScreen schema={rowDrawerSchema} qn="tasks:screen:task-list" />
          </DispatcherProvider>
        </NavProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      await user.click(screen.getByTestId("row-r1-action-add-note"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      const queryCallsBeforeSubmit = getQueryCallCount();

      const noteInput = screen.getByTestId("field-note").querySelector("input");
      if (noteInput === null) throw new Error("expected an <input> inside field-note");
      fireEvent.change(noteInput, { target: { value: "hello" } });
      await clickSubmitOnceEnabled();

      await waitFor(() => expect(writeCalls.length).toBe(1));
      expect(writeCalls[0]?.type).toBe("tasks:write:task:note");
      await waitFor(() => expect(screen.queryByTestId("render-edit-form")).toBeNull());
      await waitFor(() => expect(getQueryCallCount()).toBeGreaterThan(queryCallsBeforeSubmit));
      expect(navigateCalls).toEqual([]);
    });
  });

  // Screen-level filter is propagated from the schema into the
  // query payload. Three buckets ("scheduled" / "active" / "done")
  // share the same query handler; the filter decides which rows come.
  test("entityList screen-filter: schema.filter is included in the query payload", async () => {
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

  // TagFilter drop-in (core edit): a faceted filter on `id` — a base column NOT
  // in entity.fields — must still pass through as an op:"in" id-set so a header-
  // slot control can narrow ANY list to a resolved set of row ids. Before the
  // edit, `id` was silently dropped (only entity.fields facets survived).
  test("entityList faceted id-filter → payload.filters carries an op:'in' id-set", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      }) as unknown as Dispatcher["query"],
    });
    // useListUrlState reads `<screenId>.f.<field>` (comma-joined) from nav —
    // listScreen.id is "task-list", so this seeds an id-facet of two row ids.
    const navWithIdFilter: NavApi = {
      route: undefined,
      navigate: () => {},
      replace: () => {},
      hrefFor: (t) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: { "task-list.f.id": "r1,r2" },
      setSearchParams: () => {},
    };

    render(
      <NavProvider value={navWithIdFilter}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));

    const payload = queryCalls[0]?.payload as { filters?: unknown };
    expect(payload.filters).toEqual([{ field: "id", op: "in", value: ["r1", "r2"] }]);
  });

  // Regression guard: the default path (no screen.filter) must NOT send a
  // filter field in the queryPayload. Otherwise Zod strict would reject an
  // empty `filter: undefined` as 400, or a "match-none" default drift would
  // arise.
  test("entityList without screen.filter: queryPayload has no filter field", async () => {
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

  test("entityList rowActions visible-filter: hidden action does not appear in the DOM", async () => {
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
          visible: { field: "status", eq: "scheduled" },
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
});

// --- entityList status cells + row actions ---
// Both are leftovers: the tone heuristic and the icon-only
// collapse existed, but neither reached a list cell. These render the real
// entityList pipeline (KumikoScreen -> EntityListBody -> RenderList ->
// DataTable) against the real web primitives.
describe("KumikoScreen: entityList cell rendering", () => {
  const orderEntity = {
    fields: {
      title: { type: "text", required: true },
      status: { type: "select", options: ["active", "unmapped-value", "constructor"] },
    },
  } as unknown as EntityDefinition;

  const statusListScreen: EntityListScreenDefinition = {
    id: "order-list",
    type: "entityList",
    entity: "order",
    columns: ["title", "status"],
  };

  // No action here is id:"edit", so the primary+kebab split (bedienkonzept
  // L3/L4) falls back to the first declared action ("publish").
  const rowActionListScreen: EntityListScreenDefinition = {
    id: "order-list-actions",
    type: "entityList",
    entity: "order",
    columns: ["title"],
    rowActions: [
      { id: "publish", label: "Publish", handler: "orders:write:order:publish" },
      { id: "archive", label: "Archive", handler: "orders:write:order:archive" },
      { id: "duplicate", label: "Duplicate", handler: "orders:write:order:duplicate" },
    ],
  };

  // "review" has no icon in ACTION_ICON_BY_ID — proves the primary+kebab
  // split no longer depends on every action resolving an icon.
  const mixedActionListScreen: EntityListScreenDefinition = {
    id: "order-list-mixed",
    type: "entityList",
    entity: "order",
    columns: ["title"],
    rowActions: [
      { id: "publish", label: "Publish", handler: "orders:write:order:publish" },
      { id: "archive", label: "Archive", handler: "orders:write:order:archive" },
      { id: "review", label: "Review", handler: "orders:write:order:review" },
    ],
  };

  // projectionList reaches the same RenderList/DataTable path, so the
  // primary+kebab split has to hold there too.
  const projectionActionListScreen: ProjectionListScreenDefinition = {
    id: "order-projection-actions",
    type: "projectionList",
    query: "orders:query:order:list",
    columns: [{ field: "title", label: "Title" }],
    rowActions: [
      {
        kind: "writeHandler",
        id: "publish",
        label: "Publish",
        handler: "orders:write:order:publish",
      },
      {
        kind: "writeHandler",
        id: "archive",
        label: "Archive",
        handler: "orders:write:order:archive",
      },
      {
        kind: "writeHandler",
        id: "duplicate",
        label: "Duplicate",
        handler: "orders:write:order:duplicate",
      },
    ],
  };

  const orderSchema: FeatureSchema = {
    featureName: "orders",
    entities: { order: orderEntity },
    screens: [
      statusListScreen,
      rowActionListScreen,
      mixedActionListScreen,
      projectionActionListScreen,
    ],
  };

  function orderDispatcher(rows: readonly Record<string, unknown>[]): Dispatcher {
    return makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows, nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
  }

  async function renderOrderList(
    qn: string,
    rows: readonly Record<string, unknown>[],
  ): Promise<void> {
    render(
      <DispatcherProvider dispatcher={orderDispatcher(rows)}>
        <KumikoScreen schema={orderSchema} qn={qn} />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
  }

  test("a known status value renders a toned badge, not the muted default", async () => {
    await renderOrderList("orders:screen:order-list", [
      { id: "r1", title: "First", status: "active" },
    ]);

    const badge = screen.getByTestId("cell-r1-status").firstElementChild;
    expect(badge?.className).toContain("text-status-ok");
    expect(badge?.className).not.toContain("text-muted-foreground");
    expect(badge?.textContent).toBe("Active");
  });

  test("an unmapped select value keeps the neutral pill", async () => {
    await renderOrderList("orders:screen:order-list", [
      { id: "r1", title: "First", status: "unmapped-value" },
    ]);

    const badge = screen.getByTestId("cell-r1-status").firstElementChild;
    expect(badge?.className).toContain("text-muted-foreground");
    expect(badge?.className).not.toContain("text-status-ok");
  });

  test("an Object.prototype key is not mistaken for a tone", async () => {
    await renderOrderList("orders:screen:order-list", [
      { id: "r1", title: "First", status: "constructor" },
    ]);

    const badge = screen.getByTestId("cell-r1-status").firstElementChild;
    expect(badge?.className).toContain("text-muted-foreground");
  });

  test('three row actions, none id:"edit" → the first is the primary text button, the rest sit in the kebab (bedienkonzept L3/L4)', async () => {
    await renderOrderList("orders:screen:order-list-actions", [{ id: "r1", title: "First" }]);

    expect(screen.getByTestId("row-r1-action-publish").textContent).toBe("Publish");
    expect(screen.queryByTestId("row-r1-action-archive")).toBeNull();
    expect(screen.queryByTestId("row-r1-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
  });

  test("projectionList row actions split the same way (bedienkonzept L3/L4)", async () => {
    await renderOrderList("orders:screen:order-projection-actions", [{ id: "r1", title: "First" }]);

    expect(screen.getByTestId("row-r1-action-publish").textContent).toBe("Publish");
    expect(screen.queryByTestId("row-r1-action-archive")).toBeNull();
    expect(screen.queryByTestId("row-r1-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
  });

  test("a row-action group with an icon-less member still gets the primary+kebab split (bedienkonzept L3/L4)", async () => {
    await renderOrderList("orders:screen:order-list-mixed", [{ id: "r1", title: "First" }]);

    expect(screen.getByTestId("row-r1-action-publish").textContent).toBe("Publish");
    expect(screen.queryByTestId("row-r1-action-archive")).toBeNull();
    expect(screen.queryByTestId("row-r1-action-review")).toBeNull();
    expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
  });
});
