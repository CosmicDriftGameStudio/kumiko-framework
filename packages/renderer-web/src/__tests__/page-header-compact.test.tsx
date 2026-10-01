// Phone-width shell header: the primary page action is an icon-only button,
// everything else (secondary page actions, app headerActions) sits in ONE
// overflow panel. Desktop keeps the inline layout.

import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { ActionMenuItemSpec, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  DispatcherProvider,
  KumikoScreen,
  RenderList,
  usePrimitives,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useState } from "react";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.js";
import { ShellHeader } from "../layout/shell-header.js";
import {
  act,
  createMockDispatcher,
  fireEvent,
  renderWithSidebar,
  screen,
  waitFor,
  within,
} from "./test-utils.js";

const PHONE = 500;
const DESKTOP = 1024;
const originalWidth = window.innerWidth;

function setViewportWidth(width: number): void {
  (
    window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } }
  ).happyDOM.setInnerWidth(width);
}

afterEach(() => setViewportWidth(originalWidth));

const emptySchema = { features: [] };

const taskEntity = {
  fields: { title: { type: "text", sortable: true } },
} as unknown as EntityDefinition;

const listScreen: EntityListScreenDefinition = {
  id: "tasks:screen:task-list",
  type: "entityList",
  entity: "task",
  columns: ["title"],
};

function AppAssistant({ onShortcut }: { readonly onShortcut: () => void }): ReactNode {
  useEffect(() => {
    const listener = (): void => onShortcut();
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onShortcut]);
  return (
    <button type="button" onClick={onShortcut}>
      Assistent
    </button>
  );
}

function renderListInShell(onCreate: () => void, onApp: () => void): void {
  renderWithSidebar(
    <PageHeaderSlotProvider>
      <ShellHeader schema={emptySchema} headerActions={<AppAssistant onShortcut={onApp} />} />
      <RenderList
        screen={listScreen}
        entity={taskEntity}
        rows={[{ id: "1", title: "Foo" }]}
        featureName="tasks"
        onCreate={onCreate}
        translate={(key) => `T(${key})`}
      />
    </PageHeaderSlotProvider>,
  );
}

describe("compact shell header with a list", () => {
  test("create is a named, titled icon button that still fires; app actions wait in the overflow panel", () => {
    setViewportWidth(PHONE);
    const onCreate = mock(() => {});
    const onApp = mock(() => {});
    renderListInShell(onCreate, onApp);

    const create = screen.getByTestId("render-list-create");
    const label = create.getAttribute("aria-label");
    expect(label).toBeTruthy();
    expect(create.getAttribute("title")).toBe(label);
    expect(create.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: label ?? "" }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    const panel = screen.getByTestId("shell-header-overflow");
    expect(panel.hidden).toBe(true);
    // Stays mounted while closed so app-registered effects (shortcuts) keep running.
    expect(within(panel).getByText("Assistent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assistent" })).toBeNull();

    const trigger = screen.getByTestId("shell-header-overflow-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    fireEvent.click(screen.getByRole("button", { name: "Assistent" }));
    expect(onApp).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
  });

  test("Escape closes the panel and returns focus to the trigger; an outside press closes it too", () => {
    setViewportWidth(PHONE);
    renderListInShell(
      () => {},
      () => {},
    );
    const panel = screen.getByTestId("shell-header-overflow");
    const trigger = screen.getByTestId("shell-header-overflow-trigger");

    fireEvent.click(trigger);
    expect(panel.hidden).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(panel.hidden).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(panel.hidden).toBe(true);
  });

  test("desktop keeps the text button and the inline app actions, no overflow trigger", () => {
    setViewportWidth(DESKTOP);
    renderListInShell(
      () => {},
      () => {},
    );
    const create = screen.getByTestId("render-list-create");
    expect(create.textContent).toContain("T(");
    expect(create.getAttribute("aria-label")).toBeNull();
    expect(screen.queryByTestId("shell-header-overflow-trigger")).toBeNull();
    expect(screen.getByRole("button", { name: "Assistent" })).toBeTruthy();
  });
});

describe("compact shell header with a projection detail", () => {
  const detailScreen: ProjectionDetailScreenDefinition = {
    id: "session-detail",
    type: "projectionDetail",
    query: "sessions:query:user-session:detail",
    idParam: "id",
    header: { title: "userId" },
    layout: { sections: [{ title: "Session", fields: ["userId"] }] },
    fieldLabels: { userId: "sessions.detail.field.userId" },
    actions: [
      { kind: "navigate", id: "edit", label: "actions.edit", screen: "rent-edit", icon: "pencil" },
      {
        kind: "navigate",
        id: "duplicate",
        label: "actions.duplicate",
        screen: "rent-edit",
        icon: "copy",
      },
      {
        kind: "writeHandler",
        id: "archive",
        label: "actions.archive",
        handler: "app:write:archive",
        style: "danger",
        icon: "trash",
      },
    ],
  };
  const schema: FeatureSchema = {
    featureName: "sessions",
    entities: {},
    screens: [detailScreen],
  };
  const dispatcher: Dispatcher = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { userId: "user-42" },
    })) as unknown as Dispatcher["query"],
  });

  function renderDetail(detailSchema: FeatureSchema = schema): void {
    renderWithSidebar(
      <DispatcherProvider dispatcher={dispatcher}>
        <PageHeaderSlotProvider>
          <ShellHeader schema={{ features: [detailSchema] }} />
          <KumikoScreen
            schema={detailSchema}
            qn="sessions:screen:session-detail"
            entityId="sess-1"
          />
        </PageHeaderSlotProvider>
      </DispatcherProvider>,
    );
  }

  test("primary stays an icon-only button; the others move into the shell panel and a danger item still confirms", async () => {
    setViewportWidth(PHONE);
    renderDetail();
    await waitFor(() => screen.getByTestId("render-edit-action-edit"));

    const primary = screen.getByTestId("render-edit-action-edit");
    expect(primary.getAttribute("aria-label")).toBe("actions.edit");
    expect(primary.getAttribute("title")).toBe("actions.edit");
    expect(primary.textContent).toBe("");
    expect(screen.queryByTestId("render-edit-action-duplicate")).toBeNull();
    expect(screen.queryByTestId("kumiko-screen-projection-detail-actions-overflow")).toBeNull();

    const trigger = screen.getByTestId("shell-header-overflow-trigger");
    fireEvent.click(trigger);
    const panel = screen.getByTestId("shell-header-overflow");
    expect(within(panel).getByTestId("shell-header-overflow-item-duplicate")).toBeTruthy();

    fireEvent.click(within(panel).getByTestId("shell-header-overflow-item-archive"));
    await waitFor(() => screen.getByRole("dialog"));
    expect(panel.hidden).toBe(true);
  });

  test.each([
    ["danger", { style: "danger" as const }],
    ["confirm-gated", { confirm: "actions.terminateConfirm" }],
  ])(
    "a %s primary never becomes a bare icon button; it goes into the panel and still confirms",
    async (_name, gate) => {
      setViewportWidth(PHONE);
      const dangerSchema: FeatureSchema = {
        ...schema,
        screens: [
          {
            ...detailScreen,
            actions: [
              {
                kind: "writeHandler",
                id: "edit",
                label: "actions.terminate",
                handler: "app:write:terminate",
                icon: "x",
                ...gate,
              },
            ],
          },
        ],
      };
      renderDetail(dangerSchema);
      await waitFor(() => screen.getByTestId("shell-header-overflow-trigger"));

      expect(screen.queryByTestId("render-edit-action-edit")).toBeNull();
      fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
      fireEvent.click(screen.getByTestId("shell-header-overflow-item-edit"));
      await waitFor(() => screen.getByRole("dialog"));
    },
  );

  test("desktop keeps the primary as a text button and the existing overflow menu", async () => {
    setViewportWidth(DESKTOP);
    renderDetail();
    await waitFor(() => screen.getByTestId("render-edit-action-edit"));
    expect(screen.getByTestId("render-edit-action-edit").textContent).toBe("actions.edit");
    expect(screen.getByTestId("kumiko-screen-projection-detail-actions-overflow")).toBeTruthy();
    expect(screen.queryByTestId("shell-header-overflow-trigger")).toBeNull();
  });
});

describe("PageHeader overflowItems", () => {
  function Screen({ renders }: { readonly renders: number }): ReactNode {
    const { PageHeader } = usePrimitives();
    // Fresh array identity on every render, like a screen building items inline.
    const items: readonly ActionMenuItemSpec[] = [
      { id: `item-${renders}`, label: "Item", onSelect: () => {} },
    ];
    return PageHeader !== undefined ? <PageHeader overflowItems={items} /> : null;
  }

  function Harness(): ReactNode {
    const [renders, setRenders] = useState(0);
    return (
      <>
        <button type="button" data-testid="rerender" onClick={() => setRenders((n) => n + 1)} />
        <Screen renders={renders} />
      </>
    );
  }

  test("re-rendering with a new items array each time settles without an update loop", () => {
    setViewportWidth(PHONE);
    renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader schema={emptySchema} />
        <Harness />
      </PageHeaderSlotProvider>,
    );
    for (let i = 0; i < 5; i++) {
      act(() => {
        fireEvent.click(screen.getByTestId("rerender"));
      });
    }
    expect(screen.getByTestId("shell-header-overflow-item-item-5")).toBeTruthy();
  });

  test("items disappear from the panel when the screen unmounts", () => {
    setViewportWidth(PHONE);
    const { rerender } = renderWithSidebar(
      <PageHeaderSlotProvider>
        <ShellHeader schema={emptySchema} />
        <Screen renders={0} />
      </PageHeaderSlotProvider>,
    );
    expect(screen.getByTestId("shell-header-overflow-item-item-0")).toBeTruthy();
    rerender(
      <PageHeaderSlotProvider>
        <ShellHeader schema={emptySchema} />
      </PageHeaderSlotProvider>,
    );
    expect(screen.queryByTestId("shell-header-overflow-trigger")).toBeNull();
  });
});
