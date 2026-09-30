// rowActions kind:"drawer" renders the referenced actionForm in the Drawer
// primitive: list stays mounted behind it, header/body/footer layout, and a
// discard confirmation whenever input would be lost.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema, NavTarget } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, fireEvent, render, screen, waitFor, within } from "./test-utils.js";

const taskEntity = {
  fields: { title: { type: "text", required: true } },
} as unknown as EntityDefinition;

const noteForm: ActionFormScreenDefinition = {
  id: "task-note",
  type: "actionForm",
  handler: "tasks:write:task:note",
  description: "actions.noteHelp",
  fields: { note: { type: "text", required: true } },
  layout: { sections: [{ fields: ["note"] }] },
};

function schemaWithRowAction(
  rowAction: NonNullable<EntityListScreenDefinition["rowActions"]>[number],
): FeatureSchema {
  const listScreen: EntityListScreenDefinition = {
    id: "task-list",
    type: "entityList",
    entity: "task",
    columns: ["title"],
    rowActions: [rowAction],
  };
  return {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [listScreen, noteForm],
  };
}

const drawerAction = {
  kind: "drawer",
  id: "add-note",
  label: "actions.addNote",
  screen: "task-note",
} as const;

const DRAWER_TEST_ID = "toolbar-drawer-add-note";

type WriteCall = { readonly type: string; readonly payload: unknown };

function makeDispatcher(writeCalls: WriteCall[] = []): Dispatcher {
  return createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [{ id: "r1", title: "Alpha" }], nextCursor: null },
    })) as unknown as Dispatcher["query"],
    write: (async (type: string, payload: unknown) => {
      writeCalls.push({ type, payload });
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
}

async function openDrawer(schema: FeatureSchema, dispatcher: Dispatcher) {
  const user = userEvent.setup();
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
    </DispatcherProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
  await user.click(screen.getByTestId("row-r1-action-add-note"));
  await waitFor(() => expect(screen.getByTestId(DRAWER_TEST_ID)).toBeTruthy());
  return user;
}

function drawer() {
  return within(screen.getByTestId(DRAWER_TEST_ID));
}

function typeNote(value: string): void {
  const input = drawer().getByTestId("field-note").querySelector("input");
  if (input === null) throw new Error("expected an <input> inside field-note");
  fireEvent.change(input, { target: { value } });
}

function readNote(): string {
  const input = drawer().getByTestId("field-note").querySelector("input");
  if (input === null) throw new Error("expected an <input> inside field-note");
  return input.value;
}

const drawerSchema = schemaWithRowAction(drawerAction);

describe("rowActions kind:'drawer'", () => {
  test("opens the drawer with the form while the list stays mounted behind it", async () => {
    await openDrawer(drawerSchema, makeDispatcher());

    expect(screen.getByTestId("row-r1")).toBeTruthy();
    expect(drawer().getByTestId("field-note")).toBeTruthy();
  });

  test("header, scrolling body and footer are siblings; the form has no title of its own", async () => {
    await openDrawer(drawerSchema, makeDispatcher());

    const header = screen.getByTestId(`${DRAWER_TEST_ID}-header`);
    const body = screen.getByTestId(`${DRAWER_TEST_ID}-body`);
    const scroll = screen.getByTestId("render-edit-form-scroll");
    const footer = screen.getByTestId("render-edit-form-footer");

    expect(header.parentElement).toBe(body.parentElement);
    expect(header.contains(body)).toBe(false);
    expect(scroll.parentElement).toBe(footer.parentElement);
    expect(scroll.contains(footer)).toBe(false);
    expect(scroll.className).toContain("overflow-y-auto");
    expect(footer.className).not.toContain("overflow");
    expect(within(header).getByText("actions.addNote")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form-title")).toBeNull();
    expect(within(scroll).getByTestId("render-edit-form-subtitle")).toBeTruthy();
    expect(within(footer).getByTestId("render-edit-cancel")).toBeTruthy();
    expect(within(footer).getByTestId("render-edit-submit")).toBeTruthy();
  });

  test("closing without input needs no confirmation", async () => {
    const user = await openDrawer(drawerSchema, makeDispatcher());

    await user.click(drawer().getByLabelText("Close"));

    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());
    expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull();
  });

  test("Cancel without input closes immediately", async () => {
    const user = await openDrawer(drawerSchema, makeDispatcher());

    await user.click(drawer().getByTestId("render-edit-cancel"));

    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());
    expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull();
  });

  const closePaths: readonly {
    readonly name: string;
    readonly close: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
  }[] = [
    { name: "X button", close: (user) => user.click(drawer().getByLabelText("Close")) },
    {
      name: "Cancel button",
      close: (user) => user.click(drawer().getByTestId("render-edit-cancel")),
    },
    { name: "Escape", close: (user) => user.keyboard("{Escape}") },
  ];

  for (const { name, close } of closePaths) {
    test(`${name} after input asks before discarding; 'Keep editing' preserves the input`, async () => {
      const user = await openDrawer(drawerSchema, makeDispatcher());
      typeNote("draft text");

      await close(user);

      const dialog = await screen.findByTestId("drawer-discard-dialog");
      expect(within(dialog).getByText("Discard changes?")).toBeTruthy();
      expect(within(dialog).getByText("Your input in this form will be lost.")).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByTestId("drawer-discard-dialog-cancel"));

      await user.click(within(dialog).getByText("Keep editing"));

      await waitFor(() => expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull());
      expect(screen.getByTestId(DRAWER_TEST_ID)).toBeTruthy();
      expect(readNote()).toBe("draft text");
    });
  }

  test("'Discard' in the confirmation closes the drawer", async () => {
    const user = await openDrawer(drawerSchema, makeDispatcher());
    typeNote("draft text");
    await user.click(drawer().getByTestId("render-edit-cancel"));

    await user.click(
      within(await screen.findByTestId("drawer-discard-dialog")).getByText("Discard"),
    );

    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());
    expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull();
  });

  test("reopening after a discard starts clean and closes without confirmation", async () => {
    const user = await openDrawer(drawerSchema, makeDispatcher());
    typeNote("draft text");
    await user.click(drawer().getByTestId("render-edit-cancel"));
    await user.click(
      within(await screen.findByTestId("drawer-discard-dialog")).getByText("Discard"),
    );
    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-add-note"));
    await waitFor(() => expect(screen.getByTestId(DRAWER_TEST_ID)).toBeTruthy());
    await user.click(drawer().getByLabelText("Close"));

    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());
    expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull();
  });

  test("a successful submit closes the drawer without a confirmation", async () => {
    const writeCalls: WriteCall[] = [];
    const user = await openDrawer(drawerSchema, makeDispatcher(writeCalls));
    typeNote("hello");
    await waitFor(() => {
      expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(false);
    });

    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writeCalls.map((c) => c.type)).toEqual(["tasks:write:task:note"]));
    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());
    expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull();
  });
});

describe("rowActions without kind:'drawer'", () => {
  test("navigate still navigates and opens no drawer", async () => {
    const navigateCalls: NavTarget[] = [];
    const nav = {
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
      <NavProvider value={nav}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <KumikoScreen
            schema={schemaWithRowAction({
              kind: "navigate",
              id: "add-note",
              label: "actions.addNote",
              screen: "task-note",
            })}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("row-r1-action-add-note")).toBeTruthy());

    await user.click(screen.getByTestId("row-r1-action-add-note"));

    await waitFor(() => expect(navigateCalls).toEqual([{ screenId: "task-note" }]));
    expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull();
  });

  test("writeHandler still writes and opens no drawer", async () => {
    const writeCalls: WriteCall[] = [];
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={makeDispatcher(writeCalls)}>
        <KumikoScreen
          schema={schemaWithRowAction({
            kind: "writeHandler",
            id: "add-note",
            label: "actions.addNote",
            handler: "tasks:write:task:note",
          })}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("row-r1-action-add-note")).toBeTruthy());

    await user.click(screen.getByTestId("row-r1-action-add-note"));

    await waitFor(() => expect(writeCalls.map((c) => c.type)).toEqual(["tasks:write:task:note"]));
    expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull();
  });
});
